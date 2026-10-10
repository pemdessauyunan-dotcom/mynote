/**
 * NoteFlow desktop :: main.tsx
 * React entry for every widget window. Tauri opens multiple WebviewWindow
 * instances, each navigated to `?widget=<prefId>&note=<noteId>`. The
 * current window is transparent + frameless; native drag is enabled via
 * `data-tauri-drag-region`. All data flows through Supabase (anon key +
 * user session) so RLS enforces ownership on the server.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow, LogicalPosition } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { createClient, type Session } from "@supabase/supabase-js";
import type { Note, WidgetPreference, NoteChecklistItem } from "@noteflow/shared";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const supabase = createClient(url ?? "", anon ?? "");

type Params = { widget?: string; note?: string };
function readParams(): Params {
  const q = new URLSearchParams(location.search);
  return { widget: q.get("widget") ?? undefined, note: q.get("note") ?? undefined };
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [items, setItems] = useState<NoteChecklistItem[]>([]);
  const [pref, setPref] = useState<WidgetPreference | null>(null);
  const [status, setStatus] = useState<"online"|"offline"|"syncing"|"error">("offline");
  const [compact, setCompact] = useState(false);
  const p = useMemo(readParams, []);

  // Restore last-known snapshot from the local store plugin (via IPC),
  // so we can render immediately while the network round-trip is in flight.
  useEffect(() => {
    (async () => {
      try {
        const snap = await invoke<{ note: Note; items: NoteChecklistItem[]; pref: WidgetPreference } | null>(
          "get_widget_cache", { widgetId: p.widget ?? "" });
        if (snap) { setNote(snap.note); setItems(snap.items); setPref(snap.pref); }
      } catch {}
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [p.widget]);

  // Subscribe to realtime for this specific note + widget pref.
  useEffect(() => {
    if (!session?.user || !p.note || !p.widget) return;
    const uid = session.user.id;
    setStatus("syncing");
    (async () => {
      const [n, c, w] = await Promise.all([
        supabase.from("notes").select("*").eq("id", p.note!).eq("user_id", uid).maybeSingle(),
        supabase.from("note_checklist_items").select("*").eq("note_id", p.note!).eq("user_id", uid).order("sort_order"),
        supabase.from("widget_preferences").select("*").eq("id", p.widget!).eq("user_id", uid).maybeSingle(),
      ]);
      if (n.data) setNote(n.data as Note);
      if (c.data) setItems(c.data as NoteChecklistItem[]);
      if (w.data) {
        const wp = w.data as WidgetPreference; setPref(wp);
        // Apply persisted geometry (position, size, opacity, always-on-top)
        // to the native window. This is real OS-level window mgmt, not CSS.
        const win = getCurrentWindow();
        try {
          await win.setSize(new (await import("@tauri-apps/api/dpi").LogicalSize)(wp.width, wp.height));
          await win.setPosition(new LogicalPosition(wp.preferred_position.x, wp.preferred_position.y));
          await win.setAlwaysOnTop(wp.is_always_on_top);
          await win.setEffects({ effects: ["acrylic"] }); // Windows 10/11 backdrop if supported
        } catch {}
        document.documentElement.style.setProperty("opacity", String(wp.opacity));
        setCompact(!wp.expanded);
        await win.show();
      } else await invoke("show_widget", { widgetId: p.widget });
    })();

    const ch = supabase.channel(`widget:${p.note}:${uid}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "notes", filter: `id=eq.${p.note}` },
        (ev) => {
          if (ev.eventType === "DELETE") setNote(null);
          else setNote(ev.new as unknown as Note);
          setStatus("online");
        })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "note_checklist_items", filter: `note_id=eq.${p.note}` },
        (ev) => {
          setItems((cur) => {
            if (ev.eventType === "DELETE") return cur.filter((x) => x.id !== (ev.old as { id: string }).id);
            const next = ev.new as unknown as NoteChecklistItem;
            const has = cur.some((x) => x.id === next.id);
            const arr = has ? cur.map((x) => x.id === next.id ? next : x) : [...cur, next];
            return arr.sort((a,b)=>a.sort_order-b.sort_order);
          });
          setStatus("online");
        })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "widget_preferences", filter: `id=eq.${p.widget}` },
        (ev) => { if (ev.new) setPref(ev.new as unknown as WidgetPreference); })
      .subscribe((s) => {
        setStatus(s === "SUBSCRIBED" ? "online" : s === "CHANNEL_ERROR" ? "error" : "syncing");
      });

    return () => { supabase.removeChannel(ch); };
  }, [session?.user?.id, p.note, p.widget]);

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
        const scale = (await win.currentMonitor())?.scaleFactor ?? 1;
        const next: WidgetPreference = { ...pref,
          preferred_position: { x: Math.round(pos.x / scale), y: Math.round(pos.y / scale), monitor: null },
          width: Math.round(size.width / scale), height: Math.round(size.height / scale) };
        try { await supabase.from("widget_preferences").update({
          preferred_position: next.preferred_position, width: next.width, height: next.height,
        }).eq("id", pref.id).eq("user_id", session.user!.id); } catch {}
        // Local cache snapshot so offline relaunch restores position.
        if (note) await invoke("cache_widget", { widgetId: pref.id, note, items, pref: next }).catch(()=>{});
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
  const hideToTray = () => invoke("hide_widget", { widgetId: pref?.id ?? "" });
  const openInWeb = () => invoke("open_web_note", { noteId: note?.id ?? "" });

  if (!session) return <Pane kind="msg">Sign in from the web app to sync this widget.</Pane>;
  if (!p.widget || !p.note) return <Pane kind="msg">This window was opened without a widget id.</Pane>;
  if (!note) return <Pane kind="msg">Note is missing or was deleted on another device.</Pane>;

  return (
    <div data-shell="widget" style={{
      height: "100%", display: "flex", flexDirection: "column", gap: 8, padding: 12,
      background: "rgba(18,22,31,0.85)", color: "#e7ebf3", borderRadius: 14,
      border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden",
    }}>
      <div data-tauri-drag-region style={{ display: "flex", alignItems: "center", gap: 6, cursor: "move" }}>
        <span style={{ fontWeight: 600, flex: 1 }} data-tauri-drag-region>{note.title || "Untitled"}</span>
        <Dot status={status}/>
        <Small onClick={toggleCompactBtn} title="Toggle compact/expanded">{compact ? "⇕" : "⇔"}</Small>
        <Small onClick={hideToTray} title="Hide to tray">—</Small>
        <Small onClick={async () => {
          if (!session?.user || !pref) return;
          const next = { ...pref, is_visible: false };
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
        <Small onClick={openInWeb}>Edit in web →</Small>
      </div>
    </div>
  );
  function toggleCompactBtn() {
    if (!pref || !session?.user) return;
    const next = { ...pref, expanded: !pref.expanded };
    setPref(next); setCompact(!next.expanded);
    supabase.from("widget_preferences").update({ expanded: next.expanded }).eq("id", pref.id).eq("user_id", session.user.id).then(() => {});
  }
}

function Pane({ kind, children }: { kind: "msg"; children: React.ReactNode }) {
  return (
    <div style={{ height: "100%", display: "grid", placeItems: "center", background: "rgba(18,22,31,0.85)",
      color: "#9aa4b5", fontSize: 13, padding: 16, borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)" }}>
      {children}
    </div>
  );
}
function Dot({ status }: { status: "online"|"offline"|"syncing"|"error" }) {
  const color = status==="online" ? "#34d399" : status==="syncing" ? "#7dd3fc" : status==="error" ? "#f87171" : "#6b7688";
  return <span title={status} style={{ width: 8, height: 8, borderRadius: 99, background: color }}/>;
}
function Small({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return <button onClick={onClick} title={title} style={{
    all: "unset", cursor: "pointer", padding: "2px 6px", borderRadius: 6,
    background: "rgba(255,255,255,0.06)", fontSize: 12, color: "inherit",
  }}>{children}</button>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
