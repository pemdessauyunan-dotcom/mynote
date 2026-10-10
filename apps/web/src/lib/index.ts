/**
 * NoteFlow web :: lib.ts
 * Supabase client, offline cache, op queue, realtime subscription
 * manager, and thin API helpers. Every write is owner-scoped by RLS;
 * optimistic concurrency is enforced by the `version` column.
 */
import { createClient, type Session, type SupabaseClient, type RealtimeChannel } from "@supabase/supabase-js";
import {
  type Note, type NoteBundle, type Category, type NoteTag, type NoteChecklistItem,
  type WidgetPreference, type DevicePreference, type NoteInput, type CategoryInput,
  type ChecklistItemInput, type SyncStatus, type OfflineOperation,
  NoteInputSchema, CategoryInputSchema, ChecklistItemInputSchema,
  reconcileNote, backoffDelay, makeIdempotencyKey, newStableId,
} from "@noteflow/shared";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const DEMO_MODE = !url || !anon;
if (DEMO_MODE) {
  // eslint-disable-next-line no-console
  console.warn("[noteflow] Running in DEMO MODE - no Supabase configured. Data is local only.");
}

// createClient throws on invalid URL in some versions, so guard it.
export const supabase: SupabaseClient = (url && anon)
  ? createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: typeof window !== "undefined" ? window.localStorage : undefined,
      },
      realtime: { params: { eventsPerSecond: 10 } },
      global: { headers: { "x-client-info": "noteflow-web/0.1.0" } },
    })
  : createClient("http://localhost:54321", "placeholder-anon-key", {
      auth: { persistSession: false, autoRefreshToken: false },
    });

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */
export class ApiError extends Error {
  // `override` is required because Error already declares `cause?: unknown`.
  constructor(message: string, public readonly code?: string, public override cause?: unknown) { super(message); }
  isAuth()   { return this.code === "PGRST301" || /JWT|not_authenticated|new row violates row-level security/i.test(this.message); }
  isNetwork(){ return /Failed to fetch|NetworkError|fetch failed|timeout|ECONN/i.test(this.message); }
  isConflict(){ return /version|conflict/i.test(this.message); }
}

/* ------------------------------------------------------------------ */
/* Local cache (per-user snapshot of last fetched data)                */
/* ------------------------------------------------------------------ */
const CACHE_PREFIX = "nf.cache.";
type CacheShape = {
  ts: string;
  notes: Note[]; bundles: Record<string, { checklist: NoteChecklistItem[]; tag_ids: string[] }>;
  categories: Category[]; tags: NoteTag[]; widgetPrefs: WidgetPreference[];
};
function cacheKey(uid: string) { return CACHE_PREFIX + uid; }
export function loadCache(uid: string): CacheShape | null {
  try { const raw = localStorage.getItem(cacheKey(uid)); return raw ? JSON.parse(raw) as CacheShape : null; }
  catch { return null; }
}
export function saveCache(uid: string, patch: Partial<CacheShape>) {
  try {
    const cur = loadCache(uid) ?? { ts: "", notes: [], bundles: {}, categories: [], tags: [], widgetPrefs: [] };
    const next = { ...cur, ...patch, ts: new Date().toISOString() };
    localStorage.setItem(cacheKey(uid), JSON.stringify(next));
  } catch { /* quota / private mode; ignore - we still have server copy */ }
}
export function clearCache(uid: string) { try { localStorage.removeItem(cacheKey(uid)); } catch {} }

/* ------------------------------------------------------------------ */
/* Offline queue                                                       */
/* ------------------------------------------------------------------ */
const QUEUE_PREFIX = "nf.queue.";
function qKey(uid: string) { return QUEUE_PREFIX + uid; }
export function enqueue(uid: string, op: OfflineOperation) {
  try {
    const arr = readQueue(uid); arr.push(op);
    localStorage.setItem(qKey(uid), JSON.stringify(arr));
  } catch { /* ignore */ }
}
export function readQueue(uid: string): OfflineOperation[] {
  try { const raw = localStorage.getItem(qKey(uid)); return raw ? JSON.parse(raw) as OfflineOperation[] : []; }
  catch { return []; }
}
export function clearQueue(uid: string) { try { localStorage.removeItem(qKey(uid)); } catch {} }
/** Remove ops matching an idempotencyKey after successful flush. */
export function dequeue(uid: string, idempotencyKey: string) {
  const arr = readQueue(uid).filter((o) => o.idempotencyKey !== idempotencyKey);
  try { localStorage.setItem(qKey(uid), JSON.stringify(arr)); } catch {}
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */
async function unwrap<T>(p: Promise<{ data: T | null; error: { message: string; code?: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new ApiError(error.message, error.code);
  if (data == null) throw new ApiError("empty response");
  return data as T;
}

/** Pull everything for the current user in one go. Used on boot + reconnect. */
export async function fetchAll(uid: string) {
  const [notes, categories, tags, checklist, assignments, prefs] = await Promise.all([
    unwrap(supabase.from("notes").select("*").eq("user_id", uid).is("deleted_at", null).order("sort_order").order("updated_at", { ascending: false })),
    unwrap(supabase.from("categories").select("*").eq("user_id", uid).order("sort_order")),
    unwrap(supabase.from("note_tags").select("*").eq("user_id", uid).order("name")),
    unwrap(supabase.from("note_checklist_items").select("*").eq("user_id", uid).order("sort_order")),
    unwrap(supabase.from("note_tag_assignments").select("note_id,tag_id,user_id").eq("user_id", uid)),
    unwrap(supabase.from("widget_preferences").select("*").eq("user_id", uid).order("widget_order")),
  ]);
  const bundles: Record<string, NoteBundle> = {};
  for (const n of notes as Note[]) bundles[n.id] = { note: n, checklist: [], tag_ids: [] };
  for (const c of checklist as NoteChecklistItem[]) bundles[c.note_id]?.checklist.push(c);
  for (const a of assignments as { note_id: string; tag_id: string }[]) bundles[a.note_id]?.tag_ids.push(a.tag_id);
  return {
    notes: notes as Note[], categories: categories as Category[], tags: tags as NoteTag[],
    bundles, widgetPrefs: prefs as WidgetPreference[],
  };
}

export async function upsertNote(uid: string, input: NoteInput, expectedVersion?: number): Promise<Note> {
  const parsed = NoteInputSchema.parse(input);
  const id = parsed.id ?? newStableId();
  // `version` is managed server-side (trigger) so must never appear in the payload.
  const { version: _omitVersion, ...rest } = parsed;
  const payload = { ...rest, id, user_id: uid };

  if (expectedVersion != null) {
    // Optimistic concurrency: only succeed if server still at expectedVersion.
    const res = await supabase.from("notes")
      .update(payload as never)
      .eq("id", id).eq("user_id", uid).eq("version", expectedVersion)
      .select("*").maybeSingle();
    if (res.error) throw new ApiError(res.error.message, res.error.code);
    if (!res.data) {
      const err = new ApiError("version conflict", "CONFLICT");
      // Attach server snapshot so caller can run reconcileNote().
      (err as ApiError & { server?: Note | null }).server =
        (await supabase.from("notes").select("*").eq("id", id).maybeSingle()).data as Note | null;
      throw err;
    }
    return res.data as Note;
  }

  return unwrap(supabase.from("notes").upsert(payload, { onConflict: "id" }).select("*").single());
}

export async function softDeleteNote(uid: string, id: string) {
  return unwrap(supabase.from("notes").update({ deleted_at: new Date().toISOString() })
    .eq("id", id).eq("user_id", uid).select("*").single());
}

export async function upsertChecklistItem(uid: string, noteId: string, input: ChecklistItemInput) {
  const parsed = ChecklistItemInputSchema.parse(input);
  const id = parsed.id ?? newStableId();
  return unwrap(supabase.from("note_checklist_items").upsert(
    { ...parsed, id, note_id: noteId, user_id: uid }, { onConflict: "id" },
  ).select("*").single());
}
export async function deleteChecklistItem(uid: string, id: string) {
  const { error } = await supabase.from("note_checklist_items").delete().eq("id", id).eq("user_id", uid);
  if (error) throw new ApiError(error.message, error.code);
}

export async function assignTags(uid: string, noteId: string, tagIds: string[]) {
  // Replace existing assignments for this note.
  await supabase.from("note_tag_assignments").delete().eq("note_id", noteId).eq("user_id", uid);
  if (tagIds.length === 0) return;
  const rows = tagIds.map((tag_id) => ({ note_id: noteId, tag_id, user_id: uid }));
  const { error } = await supabase.from("note_tag_assignments").insert(rows);
  if (error) throw new ApiError(error.message, error.code);
}

export async function upsertCategory(uid: string, input: CategoryInput) {
  const parsed = CategoryInputSchema.parse(input);
  const id = parsed.id ?? newStableId();
  return unwrap(supabase.from("categories").upsert(
    { ...parsed, id, user_id: uid }, { onConflict: "id" },
  ).select("*").single());
}
export async function deleteCategory(uid: string, categoryId: string, moveTo: string | null) {
  // Reassign notes first, then delete the category (RLS ensures ownership).
  const { error: re } = await supabase.from("notes").update({ category_id: moveTo })
    .eq("user_id", uid).eq("category_id", categoryId);
  if (re) throw new ApiError(re.message, re.code);
  const { error } = await supabase.from("categories").delete().eq("id", categoryId).eq("user_id", uid);
  if (error) throw new ApiError(error.message, error.code);
}

export async function upsertWidgetPref(uid: string, pref: Omit<WidgetPreference, "id"|"user_id"|"created_at"|"updated_at"> & { id?: string }) {
  const id = pref.id ?? newStableId();
  return unwrap(supabase.from("widget_preferences").upsert(
    { ...pref, id, user_id: uid }, { onConflict: "id" },
  ).select("*").single());
}
export async function deleteWidgetPref(uid: string, id: string) {
  const { error } = await supabase.from("widget_preferences").delete().eq("id", id).eq("user_id", uid);
  if (error) throw new ApiError(error.message, error.code);
}

export async function touchDevice(uid: string, deviceId: string, name: string, type: DevicePreference["device_type"], prefs: Record<string, unknown> = {}) {
  return unwrap(supabase.from("device_preferences").upsert(
    { device_id: deviceId, device_name: name, device_type: type, preferences: prefs,
      user_id: uid, last_seen_at: new Date().toISOString() },
    { onConflict: "user_id,device_id" },
  ).select("*").single());
}

/* ------------------------------------------------------------------ */
/* Reconcile version conflict with local draft                         */
/* ------------------------------------------------------------------ */
export { reconcileNote };

/* ------------------------------------------------------------------ */
/* Realtime subscription manager                                       */
/* ------------------------------------------------------------------ */
type Handlers = {
  onNote: (n: Note) => void;
  onNoteDelete: (id: string) => void;
  onChecklist: (c: NoteChecklistItem) => void;
  onChecklistDelete: (id: string) => void;
  onCategory: (c: Category) => void;
  onTag: (t: NoteTag) => void;
  onAssignment: (a: { note_id: string; tag_id: string }) => void;
  onAssignmentDelete: (a: { note_id: string; tag_id: string }) => void;
  onWidgetPref: (w: WidgetPreference) => void;
  onStatus: (s: SyncStatus) => void;
  onReconcile: () => void; // called on reconnect to trigger a full refetch
};

export class RealtimeManager {
  private channel: RealtimeChannel | null = null;
  private reconnectTimer: number | null = null;
  private attempt = 0;
  private uid: string | null = null;
  private lastLocalWrite = new Map<string, number>(); // noteId -> ts of local write, to skip echo

  constructor(private h: Handlers) {}

  markLocalWrite(id: string) { this.lastLocalWrite.set(id, Date.now()); }

  start(uid: string) {
    this.stop();
    this.uid = uid;
    this.subscribe();
  }

  stop() {
    if (this.channel) { supabase.removeChannel(this.channel); this.channel = null; }
    if (this.reconnectTimer) { window.clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.attempt = 0;
  }

  private subscribe() {
    if (!this.uid) return;
    const uid = this.uid;
    const filter = `user_id=eq.${uid}`;
    this.h.onStatus("syncing");
    this.channel = supabase
      .channel(`notes:${uid}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notes", filter },
        (p) => this.dispatchNote(p))
      .on("postgres_changes", { event: "*", schema: "public", table: "note_checklist_items", filter },
        (p) => this.dispatchSimple(p, "checklist"))
      .on("postgres_changes", { event: "*", schema: "public", table: "categories", filter },
        (p) => this.dispatchSimple(p, "category"))
      .on("postgres_changes", { event: "*", schema: "public", table: "note_tags", filter },
        (p) => this.dispatchSimple(p, "tag"))
      .on("postgres_changes", { event: "*", schema: "public", table: "note_tag_assignments", filter },
        (p) => this.dispatchSimple(p, "assignment"))
      .on("postgres_changes", { event: "*", schema: "public", table: "widget_preferences", filter },
        (p) => this.dispatchSimple(p, "widget"))
      .subscribe((status) => {
        if (status === "SUBSCRIBED") { this.attempt = 0; this.h.onStatus("online"); }
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          this.h.onStatus("error"); this.scheduleReconnect();
        } else if (status === "CLOSED") {
          this.h.onStatus("offline"); this.scheduleReconnect();
        }
      });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = backoffDelay(this.attempt++);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.subscribe();
      // Realtime events are not a trusted source of truth after a gap: reconcile.
      this.h.onReconcile();
    }, delay);
  }

  /** Browser online/offline: pause + resume the channel cleanly. */
  notifyOnline() { if (this.channel) { this.h.onStatus("syncing"); this.h.onReconcile(); } }
  notifyOffline() { this.h.onStatus("offline"); }

  private shouldSkipEcho(newRow: { id?: string } | null, oldRow: { id?: string } | null) {
    const id = newRow?.id ?? oldRow?.id; if (!id) return false;
    const t = this.lastLocalWrite.get(id); if (!t) return false;
    if (Date.now() - t < 3000) { this.lastLocalWrite.delete(id); return true; }
    this.lastLocalWrite.delete(id); return false;
  }

  private dispatchNote(p: { eventType: string; new: Record<string, unknown>; old?: Record<string, unknown> }) {
    if (this.shouldSkipEcho(p.new as { id?: string }, p.old as { id?: string } | undefined ?? null)) return;
    if (p.eventType === "DELETE") { if (p.old?.id) this.h.onNoteDelete(p.old.id as string); return; }
    const n = p.new as unknown as Note;
    if (n.deleted_at) this.h.onNoteDelete(n.id); else this.h.onNote(n);
  }

  private dispatchSimple(p: { eventType: string; new: Record<string, unknown>; old?: Record<string, unknown> },
                         kind: "checklist"|"category"|"tag"|"assignment"|"widget") {
    if (p.eventType === "DELETE") {
      if (kind === "checklist" && p.old?.id) this.h.onChecklistDelete(p.old.id as string);
      if (kind === "assignment" && p.old) this.h.onAssignmentDelete({ note_id: p.old.note_id as string, tag_id: p.old.tag_id as string });
      return;
    }
    const row = p.new;
    if (kind === "checklist")  this.h.onChecklist(row as unknown as NoteChecklistItem);
    if (kind === "category")   this.h.onCategory(row as unknown as Category);
    if (kind === "tag")        this.h.onTag(row as unknown as NoteTag);
    if (kind === "assignment") this.h.onAssignment({ note_id: row.note_id as string, tag_id: row.tag_id as string });
    if (kind === "widget")     this.h.onWidgetPref(row as unknown as WidgetPreference);
  }
}

/* ------------------------------------------------------------------ */
/* Offline queue drain                                                 */
/* ------------------------------------------------------------------ */
export async function drainQueue(uid: string, status: (s: SyncStatus) => void, markWrite: (id: string) => void) {
  const ops = readQueue(uid);
  if (ops.length === 0) return;
  status("syncing");
  for (const op of ops) {
    try {
      switch (op.kind) {
        case "upsert_note":
          await upsertNote(uid, op.note, op.expectedVersion); markWrite(op.note.id ?? "");
          break;
        case "delete_note": await softDeleteNote(uid, op.noteId); break;
        case "upsert_checklist_item": await upsertChecklistItem(uid, op.noteId, op.item); break;
        case "delete_checklist_item": await deleteChecklistItem(uid, op.itemId); break;
        case "assign_tags": await assignTags(uid, op.noteId, op.tagIds); break;
        case "upsert_category": await upsertCategory(uid, op.category); break;
        case "delete_category": await deleteCategory(uid, op.categoryId, op.moveTo); break;
      }
      dequeue(uid, op.idempotencyKey);
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError(String(err));
      if (e.isNetwork() || e.isConflict()) { status("offline"); return; } // try later
      // Permanent error - drop the op so it does not block the queue.
      // eslint-disable-next-line no-console
      console.error("[queue] dropping op", op.kind, e.message);
      dequeue(uid, op.idempotencyKey);
    }
  }
  status("online");
}

/* ------------------------------------------------------------------ */
/* Auth helpers                                                        */
/* ------------------------------------------------------------------ */
export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
export const onAuthChange = (cb: (s: Session | null) => void) => {
  const { data } = supabase.auth.onAuthStateChange((_e, s) => cb(s));
  return () => data.subscription.unsubscribe();
};
export async function signOut() { await supabase.auth.signOut(); }
export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new ApiError(error.message, error.name);
}
export async function signUp(email: string, password: string, displayName: string) {
  const { error } = await supabase.auth.signUp({
    email, password, options: { data: { display_name: displayName } },
  });
  if (error) throw new ApiError(error.message, error.name);
}
export async function resetPassword(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/reset-password` });
  if (error) throw new ApiError(error.message, error.name);
}
export async function updatePassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new ApiError(error.message, error.name);
}

/* ------------------------------------------------------------------ */
/* Export / import                                                     */
/* ------------------------------------------------------------------ */
export function exportJSON(data: { notes: NoteBundle[]; categories: Category[]; tags: NoteTag[] }) {
  const payload = { app: "noteflow", schema: 1, exported_at: new Date().toISOString(), ...data };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `noteflow-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
export async function importJSON(file: File, uid: string, afterImport: () => void) {
  const text = await file.text();
  let obj: unknown;
  try { obj = JSON.parse(text); } catch { throw new ApiError("Invalid JSON"); }
  const parsed = (obj as { notes?: unknown[]; categories?: unknown[]; tags?: unknown[] });
  if (!Array.isArray(parsed.notes)) throw new ApiError("Missing notes array");
  for (const n of parsed.notes) {
    const note = (n as { note?: unknown }).note ?? n;
    const input = NoteInputSchema.parse(note);
    await upsertNote(uid, { ...input, id: undefined }); // force new ids to avoid collisions
  }
  afterImport();
}

/* ------------------------------------------------------------------ */
/* Small pure helpers (kept here to avoid scattering)                  */
/* ------------------------------------------------------------------ */
export const makeKey = makeIdempotencyKey;
export function relTime(iso: string): string {
  const d = Date.now() - Date.parse(iso);
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.round(d/60_000)}m ago`;
  if (d < 86_400_000) return `${Math.round(d/3_600_000)}h ago`;
  return `${Math.round(d/86_400_000)}d ago`;
}
export function isOverdue(iso: string | null): boolean {
  return !!iso && Date.parse(iso) < Date.now();
}
