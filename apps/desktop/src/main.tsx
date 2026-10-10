/**
 * NoteFlow desktop :: main.tsx
 *
 * One React entry serves two kinds of Tauri windows:
 *  - LAUNCHER (main window, no query params): sign in + pick notes to pin.
 *    On sign-in it auto-opens every widget marked `show_on_startup`.
 *  - WIDGET (windows opened as `?widget=<prefId>&note=<noteId>`): a
 *    frameless, transparent, always-on-top card that live-syncs one note
 *    via Supabase Realtime. Native drag/geometry through Tauri window APIs.
 *
 * All data flows through Supabase (anon key + user session) so RLS
 * enforces ownership on the server. The desktop app shares the SAME
 * account as the web app, which is what makes the two stay in sync.
 */
import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow, LogicalPosition, LogicalSize, currentMonitor } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { createClient, type Session } from "@supabase/supabase-js";
import type { Note, WidgetPreference, NoteChecklistItem } from "@noteflow/shared";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const supabase = createClient(url ?? "http://localhost:54321", anon ?? "placeholder-anon-key");

type Params = { widget?: string; note?: string };
function readParams(): Params {
  const q = new URLSearchParams(location.search);
  return { widget: q.get("widget") ?? undefined, note: q.get("note") ?? undefined };
}

export function App() {
  const p = useMemo(readParams, []);
  if (p.widget && p.note) return <WidgetView widgetId={p.widget} noteId={p.note} />;
  return <Launcher />;
}

// ------------------------------------------------------------------
// LAUNCHER: sign in, list notes, pin/unpin widgets, auto-open on boot
// ------------------------------------------------------------------
function Launcher() {
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [prefs, setPrefs] = useState<WidgetPreference[]>([]);

  useEffect(() => {
    if (!url || !anon) { setBooting(false); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setBooting(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // After sign-in: load notes + widget prefs, then auto-open startup widgets.
  useEffect(() => {
    if (!session?.user) return;
    const uid = session.user.id;
    (async () => {
      const [n, w] = await Promise.all([
        supabase.from("notes").select("*").eq("user_id", uid)
          .is("deleted_at", null).eq("is_archived", false)
          .order("updated_at", { ascending: false }).limit(200),
        supabase.from("widget_preferences").select("*").eq("user_id", uid).order("widget_order"),
      ]);
      setNotes((n.data as Note[]) ?? []);
      const wp = (w.data as WidgetPreference[]) ?? [];
      setPrefs(wp);
      for (const pref of wp) {
        if (pref.is_visible && pref.show_on_startup) await openWidget(pref);
      }
    })();
  }, [session?.user?.id]);

  async function openWidget(pref: WidgetPreference) {
    const pos = pref.preferred_position ?? { x: 120, y: 120, monitor: null };
    await invoke("open_widget", {
      widgetId: pref.id, noteId: pref.note_id,
      width: pref.width, height: pref.height,
      x: pos.x, y: pos.y,
      alwaysOnTop: pref.is_always_on_top, opacity: Number(pref.opacity),
    }).catch((e) => setErr(String(e)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setErr(error.message);
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) setErr(error.message);
        else setErr("Akun dibuat. Cek email untuk konfirmasi, lalu login.");
      }
    } finally { setBusy(false); }
  }

  async function pinNote(note: Note) {
    if (!session?.user) return;
    setErr(null);
    const { data, error } = await supabase.from("widget_preferences").insert({
      user_id: session.user.id, note_id: note.id, widget_order: prefs.length,
      preferred_position: { x: 140 + prefs.length * 24, y: 140 + prefs.length * 24, monitor: null },
    }).select().single();
    if (error) { setErr(error.message); return; }
    const pref = data as WidgetPreference;
    setPrefs((cur) => [...cur, pref]);
    await openWidget(pref);
  }

  async function closeWidget(pref: WidgetPreference) {
    await invoke("close_widget", { widgetId: pref.id }).catch(() => {});
    setPrefs((cur) => cur.filter((x) => x.id !== pref.id));
  }

  async function doSignOut() {
    for (const pref of prefs) await invoke("close_widget", { widgetId: pref.id }).catch(() => {});
    await supabase.auth.signOut();
  }

  if (!url || !anon) {
    return <Center>
      <h2 style={{ margin: "0 0 8px" }}>Belum dikonfigurasi</h2>
      <p style={{ opacity: 0.8, fontSize: 13 }}>
        Buat file <code>apps/desktop/.env</code> berisi <code>VITE_SUPABASE_URL</code> dan{" "}
        <code>VITE_SUPABASE_ANON_KEY</code>, lalu jalankan ulang <code>pnpm tauri dev</code>.
      </p>
    </Center>;
  }
  if (booting) return <Center>Memuat…</Center>;

  if (!session) {
    return (
      <div style={shell}>
        <div style={card}>
          <h1 style={{ fontSize: 20, margin: "0 0 4px" }}>NoteFlow Desktop</h1>
          <p style={{ opacity: 0.7, fontSize: 13, margin: "0 0 18px" }}>
            Masuk dengan akun yang sama seperti di web supaya widget tersinkron.
          </p>
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input style={input} type="email" placeholder="Email" value={email}
              onChange={(e) => setEmail(e.target.value)} required />
            <input style={input} type="password" placeholder="Password" value={password}
              onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            {err && <div style={{ color: "#f87171", fontSize: 12 }}>{err}</div>}
            <button style={btnPrimary} disabled={busy}>
              {busy ? "Memproses…" : mode === "login" ? "Masuk" : "Daftar"}
            </button>
            <button type="button" style={btnGhost}
              onClick={() => setMode((m) => (m === "login" ? "signup" : "login"))}>
              {mode === "login" ? "Belum punya akun? Daftar" : "Sudah punya akun? Masuk"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const pinnedNoteIds = new Set(prefs.map((p) => p.note_id));
  return (
    <div style={shell}>
      <div style={{ ...card, maxWidth: 520 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <h1 style={{ fontSize: 18, margin: 0, flex: 1 }}>NoteFlow Desktop</h1>
          <span style={{ fontSize: 12, opacity: 0.6 }}>{session.user.email}</span>
          <button style={btnGhost} onClick={doSignOut}>Keluar</button>
        </div>
        {err && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 10 }}>{err}</div>}

        <h2 style={h2}>Widget aktif ({prefs.length})</h2>
        {prefs.length === 0 && <p style={muted}>Belum ada widget. Pin catatan di bawah.</p>}
        {prefs.map((pref) => {
          const note = notes.find((n) => n.id === pref.note_id);
          return (
            <Row key={pref.id}>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {note?.title || "Catatan"}
              </span>
              <button style={btnSmall} onClick={() => openWidget(pref)}>Buka</button>
              <button style={btnSmall} onClick={() => closeWidget(pref)}>Tutup</button>
            </Row>
          );
        })}

        <h2 style={h2}>Pin catatan ke desktop</h2>
        {notes.length === 0 && <p style={muted}>Belum ada catatan. Buat dulu di web app.</p>}
        {notes.filter((n) => !pinnedNoteIds.has(n.id)).slice(0, 40).map((note) => (
          <Row key={note.id}>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {note.title || "Untitled"}
            </span>
            <button style={btnSmall} onClick={() => pinNote(note)}>+ Pin</button>
          </Row>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// WIDGET VIEW: one live-synced note in a frameless native window
// ------------------------------------------------------------------
function WidgetView({ widgetId, noteId }: { widgetId: string; noteId: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [items, setItems] = useState<NoteChecklistItem[]>([]);
  const [pref, setPref] = useState<WidgetPreference | null>(null);
  const [status, setStatus] = useState<"online" | "offline" | "syncing" | "error">("offline");
  const [compact, setCompact] = useState(false);

  // Restore last-known snapshot from the local store plugin (via IPC),
  // so we can render immediately while the network round-trip is in flight.
  useEffect(() => {
    (async () => {
      try {
        const snap = await invoke<{ note: Note; items: NoteChecklistItem[]; pref: WidgetPreference } | null>(
          "get_widget_cache", { widgetId });
        if (snap) { setNote(snap.note); setItems(snap.items); setPref(snap.pref); }
      } catch {}
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [widgetId]);

  // Subscribe to realtime for this specific note + widget pref.
  useEffect(() => {
    if (!session?.user || !noteId || !widgetId) return;
    const uid = session.user.id;
    setStatus("syncing");
    (async () => {
      const [n, c, w] = await Promise.all([
        supabase.from("notes").select("*").eq("id", noteId).eq("user_id", uid).maybeSingle(),
        supabase.from("note_checklist_items").select("*").eq("note_id", noteId).eq("user_id", uid).order("sort_order"),
        supabase.from("widget_preferences").select("*").eq("id", widgetId).eq("user_id", uid).maybeSingle(),
      ]);
      if (n.data) setNote(n.data as Note);
      if (c.data) setItems(c.data as NoteChecklistItem[]);
      if (w.data) {
        const wp = w.data as WidgetPreference; setPref(wp);
        const win = getCurrentWindow();
        try {
          await win.setSize(new LogicalSize(wp.width, wp.height));
          await win.setPosition(new LogicalPosition(wp.preferred_position.x, wp.preferred_position.y));
          await win.setAlwaysOnTop(wp.is_always_on_top);
          await win.setEffects({ effects: ["acrylic"] as never }); // Windows 10/11 backdrop if supported
        } catch {}
        document.documentElement.style.setProperty("opacity", String(wp.opacity));
        setCompact(!wp.expanded);
        await win.show();
      } else await invoke("show_widget", { widgetId });
    })();

    const ch = supabase.channel(`widget:${noteId}:${uid}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "notes", filter: `id=eq.${noteId}` },
        (ev) => {
          if (ev.eventType === "DELETE") setNote(null);
          else setNote(ev.new as unknown as Note);
          setStatus("online");
        })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "note_checklist_items", filter: `note_id=eq.${noteId}` },
        (ev) => {
          setItems((cur) => {
            if (ev.eventType === "DELETE") return cur.filter((x) => x.id !== (ev.old as { id: string }).id);
            const next = ev.new as unknown as NoteChecklistItem;
            const has = cur.some((x) => x.id === next.id);
            const arr = has ? cur.map((x) => x.id === next.id ? next : x) : [...cur, next];
            return arr.sort((a, b) => a.sort_order - b.sort_order);
          });
          setStatus("online");
        })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "widget_preferences", filter: `id=eq.${widgetId}` },
        (ev) => { if (ev.new) setPref(ev.new as unknown as WidgetPreference); })
      .subscribe((s) => {
        setStatus(s === "SUBSCRIBED" ? "online" : s === "CHANNEL_ERROR" ? "error" : "syncing");
      });

    return () => { supabase.removeChannel(ch); };
  }, [session?.user?.id, noteId, widgetId]);

  // Persist window geometry when user drags/resizes the native window.
  useEffect(() => {
    if (!session?.user || !pref) return;
    const win = getCurrentWindow();
    let t: number | null = null;
    const un = win.onMoved(async () => {
      if (t) clearTimeout(t);
      t = window.setTimeout(async () => {
        const pos = await win.outerPosition();
        const size = await win.outerSize();
        const scale = (await currentMonitor())?.scaleFactor ?? 1;
        const next: WidgetPreference = { ...pref,
          preferred_position: { x: Math.round(pos.x / scale), y: Math.round(pos.y / scale), monitor: null },
          width: Math.round(size.width / scale), height: Math.round(size.height / scale) };
        try { await supabase.from("widget_preferences").update({
          preferred_position: next.preferred_position, width: next.width, height: next.height,
        }).eq("id", pref.id).eq("user_id", session.user!.id); } catch {}
        if (note) await invoke("cache_widget", { widgetId: pref.id, note, items, pref: next }).catch(() => {});
      }, 400);
    });
    return () => { if (t) clearTimeout(t); un.then((f) => f()); };
  }, [session?.user?.id, pref, note, items]);

  const toggleCheck = async (id: string, done: boolean) => {
    if (!session?.user || !note) return;
    const cur = items.find((x) => x.id === id); if (!cur) return;
    const next = { ...cur, is_completed: done };
    setItems((arr) => arr.map((x) => x.id === id ? next : x));
    await supabase.from("note_checklist_items").update({ is_completed: done }).eq("id", id).eq("user_id", session.user.id);
  };
  const hideToTray = () => invoke("hide_widget", { widgetId: pref?.id ?? widgetId });
  const openInWeb = () => invoke("open_web_note", { noteId: note?.id ?? noteId });

  if (!session) return <Pane>Sign in from the NoteFlow Desktop launcher to sync this widget.</Pane>;
  if (!note) return <Pane>Note is missing or was deleted on another device.</Pane>;

  function toggleCompactBtn() {
    if (!pref || !session?.user) return;
    const next = { ...pref, expanded: !pref.expanded };
    setPref(next); setCompact(!next.expanded);
    supabase.from("widget_preferences").update({ expanded: next.expanded }).eq("id", pref.id).eq("user_id", session.user.id).then(() => {});
  }

  return (
    <div data-shell="widget" style={{
      height: "100%", display: "flex", flexDirection: "column", gap: 8, padding: 12,
      background: "rgba(18,22,31,0.85)", color: "#e7ebf3", borderRadius: 14,
      border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden",
    }}>
      <div data-tauri-drag-region style={{ display: "flex", alignItems: "center", gap: 6, cursor: "move" }}>
        <span style={{ fontWeight: 600, flex: 1 }} data-tauri-drag-region>{note.title || "Untitled"}</span>
        <Dot status={status} />
        <Small onClick={toggleCompactBtn} title="Toggle compact/expanded">{compact ? "⇕" : "⇔"}</Small>
        <Small onClick={hideToTray} title="Hide to tray">—</Small>
        <Small onClick={async () => {
          if (!session?.user || !pref) return;
          await supabase.from("widget_preferences").update({ is_visible: false }).eq("id", pref.id).eq("user_id", session.user.id);
          await getCurrentWindow().close();
        }} title="Close widget (does not delete note)">✕</Small>
      </div>
      {!compact && (
        <div style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.5, opacity: 0.9, overflow: "auto", maxHeight: "45%" }}>
          {note.content}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, overflow: "auto", flex: 1 }}>
        {items.map((c) => (
          <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={c.is_completed} onChange={(e) => toggleCheck(c.id, e.target.checked)}
              style={{ accentColor: "#818cf8" }} />
            <span style={{ textDecoration: c.is_completed ? "line-through" : "none", opacity: c.is_completed ? 0.6 : 1 }}>{c.text}</span>
          </label>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, opacity: 0.65 }}>
        <span>Updated {new Date(note.updated_at).toLocaleString()}</span>
        <Small onClick={openInWeb} title="Open this note in the web app">Edit in web →</Small>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Shared bits
// ------------------------------------------------------------------
function Pane({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ height: "100%", display: "grid", placeItems: "center", background: "rgba(18,22,31,0.85)",
      color: "#9aa4b5", fontSize: 13, padding: 16, borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)", textAlign: "center" }}>
      {children}
    </div>
  );
}
function Dot({ status }: { status: "online" | "offline" | "syncing" | "error" }) {
  const color = status === "online" ? "#34d399" : status === "syncing" ? "#7dd3fc" : status === "error" ? "#f87171" : "#6b7688";
  return <span title={status} style={{ width: 8, height: 8, borderRadius: 99, background: color }} />;
}
function Small({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return <button onClick={onClick} title={title} style={{
    all: "unset", cursor: "pointer", padding: "2px 6px", borderRadius: 6,
    background: "rgba(255,255,255,0.06)", fontSize: 12, color: "inherit",
  }}>{children}</button>;
}
function Center({ children }: { children: React.ReactNode }) {
  return <div style={{ ...shell, textAlign: "center" }}>{children}</div>;
}
function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{children}</div>;
}

const shell: React.CSSProperties = {
  height: "100vh", display: "grid", placeItems: "center",
  background: "#0d1017", color: "#e7ebf3", fontFamily: "system-ui, sans-serif", padding: 16,
};
const card: React.CSSProperties = {
  width: "100%", background: "#171c26", border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16, padding: 22, boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
};
const input: React.CSSProperties = {
  background: "#0f131b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10,
  padding: "10px 12px", color: "#e7ebf3", fontSize: 14, outline: "none",
};
const btnPrimary: React.CSSProperties = {
  background: "#6366f1", color: "#fff", border: "none", borderRadius: 10,
  padding: "10px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer",
};
const btnGhost: React.CSSProperties = {
  background: "transparent", color: "#9aa4b5", border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 10, padding: "8px 12px", fontSize: 13, cursor: "pointer",
};
const btnSmall: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)", color: "#e7ebf3", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8, padding: "4px 10px", fontSize: 12, cursor: "pointer",
};
const h2: React.CSSProperties = { fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.6, margin: "18px 0 6px" };
const muted: React.CSSProperties = { fontSize: 13, opacity: 0.55, margin: "4px 0" };

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
