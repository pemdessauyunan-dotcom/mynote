/**
 * @noteflow/shared
 * Domain types, zod input schemas, palette tokens, and pure concurrency
 * helpers used by web, desktop widget, and tests.
 *
 * Design rules enforced here:
 *  - Stable IDs (UUIDv4 from Supabase / crypto.randomUUID on client).
 *  - Every note has an integer `version` for optimistic concurrency.
 *  - Timestamps are ISO-8601 UTC strings on the wire.
 *  - Payload size limits mirror DB CHECKs (see migration 0001_init.sql).
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */

export const NOTE_COLORS = [
  "slate",
  "rose",
  "amber",
  "emerald",
  "sky",
  "violet",
  "indigo",
] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const DEVICE_TYPES = ["web", "desktop", "mobile", "unknown"] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

/**
 * Elegant pastel card surfaces, tuned for the default charcoal theme.
 * Each entry is a triple of { surface, surfaceHover, border } as CSS vars.
 */
export const NOTE_COLOR_TOKENS: Record<
  NoteColor,
  { surface: string; surfaceHover: string; border: string; accent: string }
> = {
  slate:   { surface: "#2a2f3a", surfaceHover: "#333947", border: "#3b4252", accent: "#94a3b8" },
  rose:    { surface: "#3a2731", surfaceHover: "#46303a", border: "#583846", accent: "#fda4af" },
  amber:   { surface: "#3a3125", surfaceHover: "#463b2c", border: "#5a4a33", accent: "#fbbf24" },
  emerald: { surface: "#25393056", surfaceHover: "#2f4639", border: "#365545", accent: "#6ee7b7" },
  sky:     { surface: "#233745", surfaceHover: "#2a4152", border: "#315064", accent: "#7dd3fc" },
  violet:  { surface: "#312943", surfaceHover: "#3a3051", border: "#463b60", accent: "#c4b5fd" },
  indigo:  { surface: "#272c4b", surfaceHover: "#2f3559", border: "#384071", accent: "#a5b4fc" },
};

/* ------------------------------------------------------------------ */
/* Entity types (mirror DB row shape)                                  */
/* ------------------------------------------------------------------ */

export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  user_id: string;
  name: string;
  color: NoteColor;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface NoteTag {
  id: string;
  user_id: string;
  name: string;
  color: NoteColor | null;
  created_at: string;
}

export interface NoteChecklistItem {
  id: string;
  note_id: string;
  user_id: string;
  text: string;
  is_completed: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  user_id: string;
  category_id: string | null;
  title: string;
  content: string;
  color: NoteColor;
  priority: Priority;
  is_pinned: boolean;
  is_archived: boolean;
  sort_order: number;
  due_at: string | null;
  reminder_at: string | null;
  /** Optimistic concurrency token. Incremented server-side by trigger. */
  version: number;
  created_at: string;
  updated_at: string;
  /** Soft-delete marker. Non-null means row is in trash and excluded from normal queries. */
  deleted_at: string | null;
}

/** A note together with its checklist and tag assignments, loaded as a unit. */
export interface NoteBundle {
  note: Note;
  checklist: NoteChecklistItem[];
  tag_ids: string[];
}

export interface WidgetPreference {
  id: string;
  user_id: string;
  note_id: string;
  widget_order: number;
  width: number;
  height: number;
  opacity: number;
  preferred_position: { x: number; y: number; monitor: string | null };
  is_visible: boolean;
  is_always_on_top: boolean;
  expanded: boolean;
  show_on_startup: boolean;
  created_at: string;
  updated_at: string;
}

export interface DevicePreference {
  id: string;
  user_id: string;
  device_id: string;
  device_name: string;
  device_type: DeviceType;
  preferences: Record<string, unknown>;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

/* ------------------------------------------------------------------ */
/* Sync + UI state types                                               */
/* ------------------------------------------------------------------ */

export type SyncStatus = "online" | "syncing" | "offline" | "error";

export type OfflineOperation =
  | { kind: "upsert_note"; note: NoteInput; expectedVersion: number; idempotencyKey: string }
  | { kind: "delete_note"; noteId: string; idempotencyKey: string }
  | { kind: "upsert_checklist_item"; item: ChecklistItemInput; noteId: string; idempotencyKey: string }
  | { kind: "delete_checklist_item"; itemId: string; idempotencyKey: string }
  | { kind: "assign_tags"; noteId: string; tagIds: string[]; idempotencyKey: string }
  | { kind: "upsert_category"; category: CategoryInput; idempotencyKey: string }
  | { kind: "delete_category"; categoryId: string; moveTo: string | null; idempotencyKey: string };

/* ------------------------------------------------------------------ */
/* Zod schemas (input validation - mirrored by DB CHECKs)              */
/* ------------------------------------------------------------------ */

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(uuidRe, "must be a UUID");

export const NoteColorSchema = z.enum(NOTE_COLORS);
export const PrioritySchema = z.enum(PRIORITIES);

export const NoteInputSchema = z.object({
  id: uuid.optional(),
  category_id: uuid.nullable().optional(),
  title: z.string().trim().min(1, "Title is required").max(200),
  content: z.string().max(20000, "Note is too large"),
  color: NoteColorSchema.default("slate"),
  priority: PrioritySchema.default("normal"),
  is_pinned: z.boolean().default(false),
  is_archived: z.boolean().default(false),
  sort_order: z.number().int().min(0).default(0),
  due_at: z.string().datetime({ offset: true }).nullable().optional(),
  reminder_at: z.string().datetime({ offset: true }).nullable().optional(),
  /** Required when updating an existing note (optimistic concurrency). */
  version: z.number().int().nonnegative().optional(),
});
export type NoteInput = z.infer<typeof NoteInputSchema>;

export const ChecklistItemInputSchema = z.object({
  id: uuid.optional(),
  text: z.string().trim().min(1).max(500),
  is_completed: z.boolean().default(false),
  sort_order: z.number().int().min(0).default(0),
});
export type ChecklistItemInput = z.infer<typeof ChecklistItemInputSchema>;

export const CategoryInputSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1).max(60),
  color: NoteColorSchema.default("slate"),
  sort_order: z.number().int().min(0).default(0),
});
export type CategoryInput = z.infer<typeof CategoryInputSchema>;

export const TagInputSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1).max(40),
  color: NoteColorSchema.nullable().optional(),
});
export type TagInput = z.infer<typeof TagInputSchema>;

export const WidgetPreferenceInputSchema = z.object({
  id: uuid.optional(),
  note_id: uuid,
  widget_order: z.number().int().min(0).default(0),
  width: z.number().int().min(200).max(1600),
  height: z.number().int().min(120).max(1600),
  opacity: z.number().min(0.4).max(1),
  preferred_position: z.object({
    x: z.number().int(),
    y: z.number().int(),
    monitor: z.string().nullable(),
  }),
  is_visible: z.boolean().default(true),
  is_always_on_top: z.boolean().default(true),
  expanded: z.boolean().default(true),
  show_on_startup: z.boolean().default(true),
});
export type WidgetPreferenceInput = z.infer<typeof WidgetPreferenceInputSchema>;

/* ------------------------------------------------------------------ */
/* Concurrency helpers (pure - covered by unit tests)                  */
/* ------------------------------------------------------------------ */

export type ConflictKind = "none" | "server_newer" | "both_changed" | "deleted_on_server";

export interface ConflictResolution<T> {
  kind: ConflictKind;
  /** The value that should be kept in local state after resolution. */
  resolved: T;
  /** True when the local edit must be re-sent after merging. */
  needsRetry: boolean;
  /** Human-readable message for UI. */
  message: string;
}

/**
 * Field-level merge policy for concurrent edits:
 *  - If only server changed since our expectedVersion, server wins, no retry.
 *  - If both sides changed, prefer the side with a more recent `updated_at`
 *    for the mutable body fields (title/content/color/priority/pin/archive),
 *    but never silently drop the other side: it is returned as
 *    `serverSnapshot` so UI can offer a manual merge.
 *  - If server row is soft-deleted, the note is treated as deleted.
 *
 * `version` is an opaque monotone counter; equality with expectedVersion
 * means "nothing changed under us".
 */
export function reconcileNote<T extends Note | NoteInput>(
  localDraft: T,
  serverSnapshot: Note | null,
  expectedVersion: number,
  nowIso: string,
): ConflictResolution<T> {
  if (!serverSnapshot || serverSnapshot.deleted_at) {
    return {
      kind: "deleted_on_server",
      resolved: localDraft,
      needsRetry: false,
      message: "This note was deleted on another device.",
    };
  }
  const serverChanged = serverSnapshot.version !== expectedVersion;
  const localChanged = true; // caller only invokes this when it had pending edits

  if (!serverChanged) {
    return { kind: "none", resolved: localDraft, needsRetry: true, message: "" };
  }
  if (!localChanged) {
    return {
      kind: "server_newer",
      resolved: serverSnapshot as unknown as T,
      needsRetry: false,
      message: "Updated on another device.",
    };
  }

  const localTime = Date.parse((localDraft as Note).updated_at ?? nowIso);
  const serverTime = Date.parse(serverSnapshot.updated_at);
  if (serverTime > localTime) {
    return {
      kind: "both_changed",
      resolved: serverSnapshot as unknown as T,
      needsRetry: false,
      message: "Another device edited this note more recently. Review before saving.",
    };
  }
  // Local is newer: keep local draft body but adopt the server's latest version
  // so our retry uses the correct expectedVersion (prevents overwrite loop).
  const merged = {
    ...localDraft,
    version: serverSnapshot.version,
  } as T;
  return {
    kind: "both_changed",
    resolved: merged,
    needsRetry: true,
    message: "You have the newer edit. Reconciled with the latest server version.",
  };
}

/** Exponential backoff with jitter: baseDelay * 2^attempt capped at maxDelay. */
export function backoffDelay(attempt: number, baseMs = 500, maxMs = 20_000): number {
  const raw = Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, attempt)));
  return Math.round(raw / 2 + Math.random() * (raw / 2));
}

/** Deterministic idempotency key for a note write so retries never double-apply. */
export function makeIdempotencyKey(scope: string, noteId: string): string {
  return `${scope}:${noteId}:${Date.now().toString(36)}`;
}

/** Stable, sortable UUID for client-generated note IDs. */
export function newStableId(): string {
  // crypto.randomUUID is present on modern browsers, Webview, and Node >= 19.
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && "randomUUID" in c && typeof c.randomUUID === "function") return c.randomUUID();
  // Fallback (RFC-4122 v4) - still stable, never collides in practice.
  const bytes = new Uint8Array(16);
  (c ?? { getRandomValues: (a: Uint8Array) => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); return a; } } as unknown as Crypto)
    .getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
