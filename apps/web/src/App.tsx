/**
 * NoteFlow web :: App.tsx
 * Router + providers + auth pages + dashboard + note editor + settings
 * + widget manager. Kept in one file to fit the whole vertical slice
 * in a single review surface.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, Link, useParams, useLocation, Outlet } from "react-router-dom";
import {
  Plus, Search, Settings as SettingsIcon, Home, Archive as ArchiveIcon,
  LayoutDashboard, Smartphone, Monitor, LogOut, Menu, X, Bell, Pin, Trash2,
  Tag as TagIcon, Grid2x2 as GridIcon, List as ListIcon, Save,
} from "lucide-react";
import { useUI, useAuth, useData, useSync, useFilter } from "./store";
import {
  supabase, getSession, onAuthChange, signIn, signUp, signOut, resetPassword, updatePassword,
  fetchAll, upsertNote, softDeleteNote, upsertChecklistItem, deleteChecklistItem,
  assignTags, upsertCategory, deleteCategory, upsertWidgetPref, deleteWidgetPref, touchDevice,
  RealtimeManager, drainQueue, enqueue, makeKey, loadCache, saveCache, ApiError,
  relTime, isOverdue, DEMO_MODE,
} from "./lib";
import {
  Button, Input, Textarea, Modal, Confirm, ToastHost, Skeleton, EmptyState,
  ColorSwatches, PriorityPicker, DateTimeLocal, Checklist, NoteCard, SyncBadge,
  ThemeToggle, ViewToggle, SearchInput, RemindersList, WidgetRow, Icons, useDebouncedEffect,
} from "./components";
import type {
  Note, NoteInput, NoteColor, Category, WidgetPreference, SyncStatus,
} from "@noteflow/shared";
import { NOTE_COLORS, reconcileNote, newStableId } from "@noteflow/shared";

/* ------------------------------------------------------------------ */
/* Root                                                                */
/* ------------------------------------------------------------------ */
export function App() {
  return (
    <BrowserRouter>
      <Bootstrap />
    </BrowserRouter>
  );
}

function Bootstrap() {
  const setSession = useAuth((s) => s.setSession);
  const setLoading = useAuth((s) => s.setLoading);
  const { status, toasts, setStatus, toast, dismiss } = useSync();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (DEMO_MODE) {
      // Auto-login with demo data so the full UI is explorable without Supabase.
      setSession("demo-user-0000", "demo@noteflow.app", "Demo User");
      setReady(true);
      return;
    }
    (async () => {
      const s = await getSession();
      if (s?.user) setSession(s.user.id, s.user.email, s.user.user_metadata?.display_name ?? "");
      else setSession(null, null);
      setReady(true);
    })();
    return onAuthChange((s) => {
      if (!s?.user) { setSession(null, null); }
      else setSession(s.user.id, s.user.email, s.user.user_metadata?.display_name ?? "");
    });
  }, [setSession, setLoading]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", useUI.getState().theme);
    const unsub = useUI.subscribe((s) => document.documentElement.setAttribute("data-theme", s.theme));
    return unsub;
  }, []);

  useEffect(() => {
    const on = () => setStatus("syncing");
    const off = () => setStatus("offline");
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [setStatus]);

  if (!ready) return <SplashScreen />;
  const uid = useAuth.getState().userId;
  return (
    <>
      <Routes>
        <Route path="/login"        element={uid ? <Navigate to="/" /> : <AuthPage mode="login" />} />
        <Route path="/signup"       element={uid ? <Navigate to="/" /> : <AuthPage mode="signup" />} />
        <Route path="/forgot"       element={<AuthPage mode="forgot" />} />
        <Route path="/reset-password" element={<AuthPage mode="reset" />} />
        <Route element={<RequireAuth />}>
          <Route element={<Shell />}>
            <Route index element={<DashboardPage />} />
            <Route path="notes/:id" element={<NoteEditorPage />} />
            <Route path="archived" element={<ArchivedPage />} />
            <Route path="categories" element={<CategoriesPage />} />
            <Route path="widgets" element={<WidgetManagerPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </>
  );
}

function SplashScreen() {
  return <div className="flex h-full items-center justify-center text-sm text-muted">Loading NoteFlow…</div>;
}

function RequireAuth() {
  const uid = useAuth((s) => s.userId);
  return uid ? <Outlet /> : <Navigate to="/login" replace />;
}

/* ------------------------------------------------------------------ */
/* Data loader (used inside authenticated shell)                       */
/* ------------------------------------------------------------------ */
function Shell() {
  const uid = useAuth((s) => s.userId)!;
  const hydrate = useData((s) => s.hydrate);
  const setSession = useAuth((s) => s.setSession);
  const { status, setStatus, toast } = useSync();
  const rtRef = useRef<RealtimeManager | null>(null);
  const [booting, setBooting] = useState(true);

  const reload = useCallback(async () => {
    if (DEMO_MODE) {
      // Populate with demo notes for UI preview without Supabase.
      const now = new Date().toISOString();
      const demoNotes: Note[] = [
        { id: "a1", user_id: uid, category_id: "c1", title: "Welcome to NoteFlow", content: "This is your first note. It syncs in real time between web, mobile PWA, and the Windows desktop widget.", color: "indigo", priority: "normal", is_pinned: true, is_archived: false, sort_order: 0, due_at: null, reminder_at: null, version: 1, created_at: now, updated_at: now, deleted_at: null },
        { id: "a2", user_id: uid, category_id: "c2", title: "Review Q4 report", content: "Draft due Friday afternoon. Check revenue metrics.", color: "amber", priority: "high", is_pinned: false, is_archived: false, sort_order: 1, due_at: new Date(Date.now()+86400000*2).toISOString(), reminder_at: new Date(Date.now()+86400000).toISOString(), version: 1, created_at: now, updated_at: now, deleted_at: null },
        { id: "a3", user_id: uid, category_id: "c1", title: "Grocery list", content: "Weekly essentials.", color: "emerald", priority: "low", is_pinned: false, is_archived: false, sort_order: 2, due_at: null, reminder_at: null, version: 1, created_at: now, updated_at: now, deleted_at: null },
        { id: "a4", user_id: uid, category_id: "c3", title: "Project ideas", content: "\u2022 Mobile app\n\u2022 Portfolio site\n\u2022 API toolkit", color: "violet", priority: "normal", is_pinned: true, is_archived: false, sort_order: 3, due_at: null, reminder_at: null, version: 1, created_at: now, updated_at: now, deleted_at: null },
        { id: "a5", user_id: uid, category_id: null, title: "Meeting notes", content: "Discussed timeline and deliverables. Follow up on action items by Monday.", color: "sky", priority: "normal", is_pinned: false, is_archived: false, sort_order: 4, due_at: null, reminder_at: null, version: 1, created_at: now, updated_at: now, deleted_at: null },
      ];
      const demoCats = [
        { id: "c1", user_id: uid, name: "Personal" as never, color: "sky" as NoteColor, sort_order: 1, created_at: now, updated_at: now },
        { id: "c2", user_id: uid, name: "Work" as never, color: "indigo" as NoteColor, sort_order: 2, created_at: now, updated_at: now },
        { id: "c3", user_id: uid, name: "Ideas" as never, color: "violet" as NoteColor, sort_order: 3, created_at: now, updated_at: now },
      ];
      const demoTags = [{ id: "t1", user_id: uid, name: "focus" as never, color: "violet" as NoteColor, created_at: now }];
      const bundles: Record<string, { checklist: import("@noteflow/shared").NoteChecklistItem[]; tag_ids: string[] }> = {
        a1: { checklist: [
          { id: "ci1", note_id: "a1", user_id: uid, text: "Sign in from your phone", is_completed: false, sort_order: 0, created_at: now, updated_at: now },
          { id: "ci2", note_id: "a1", user_id: uid, text: "Open the desktop widget app", is_completed: false, sort_order: 1, created_at: now, updated_at: now },
          { id: "ci3", note_id: "a1", user_id: uid, text: "Edit this note and watch it update everywhere", is_completed: false, sort_order: 2, created_at: now, updated_at: now },
        ], tag_ids: [] },
        a4: { checklist: [], tag_ids: ["t1"] },
        a2: { checklist: [], tag_ids: [] },
        a3: { checklist: [
          { id: "ci4", note_id: "a3", user_id: uid, text: "Milk", is_completed: true, sort_order: 0, created_at: now, updated_at: now },
          { id: "ci5", note_id: "a3", user_id: uid, text: "Bread", is_completed: false, sort_order: 1, created_at: now, updated_at: now },
          { id: "ci6", note_id: "a3", user_id: uid, text: "Eggs", is_completed: false, sort_order: 2, created_at: now, updated_at: now },
        ], tag_ids: [] },
        a5: { checklist: [], tag_ids: [] },
      };
      hydrate({ notes: demoNotes, categories: demoCats, tags: demoTags, widgetPrefs: [],
        bundles: Object.fromEntries(Object.entries(bundles).map(([k,v]) => [k, { note: demoNotes.find(n=>n.id===k)!, ...v }])) });
      setStatus("online");
      setBooting(false);
      return;
    }
    try {
      const d = await fetchAll(uid);
      hydrate(d); saveCache(uid, {
        notes: d.notes, bundles: d.bundles, categories: d.categories,
        tags: d.tags, widgetPrefs: d.widgetPrefs,
      });
      setStatus("online");
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError(String(err));
      if (e.isAuth()) { setSession(null, null); return; }
      const cached = loadCache(uid);
      if (cached) {
        hydrate({ notes: cached.notes, categories: cached.categories, tags: cached.tags,
          bundles: Object.fromEntries(Object.entries(cached.bundles).map(([k, v]) => [k,
            { note: cached.notes.find((n) => n.id === k)!, checklist: v.checklist, tag_ids: v.tag_ids }])),
          widgetPrefs: cached.widgetPrefs });
        toast("info", "Showing cached data — offline");
        setStatus("offline");
      } else setStatus("error");
    } finally { setBooting(false); }
  }, [uid, hydrate, setSession, setStatus, toast]);

  useEffect(() => {
    const rt = new RealtimeManager({
      onNote: (n) => useData.getState().upsertNote(n),
      onNoteDelete: (id) => useData.getState().removeNote(id),
      onChecklist: (c) => useData.getState().upsertChecklist(c),
      onChecklistDelete: (id) => useData.getState().removeChecklist(id),
      onCategory: (c) => useData.getState().upsertCategory(c),
      onTag: (t) => useData.getState().upsertTag(t),
      onAssignment: (a) => useData.getState().assignTag(a),
      onAssignmentDelete: (a) => useData.getState().unassignTag(a),
      onWidgetPref: (w) => useData.getState().upsertWidgetPref(w),
      onStatus: (s) => setStatus(s),
      onReconcile: () => reload(),
    });
    rtRef.current = rt;
    reload().then(() => rt.start(uid));
    // Drain offline queue when connection returns
    const onOnline = () => { drainQueue(uid, setStatus, (id) => rt.markLocalWrite(id)); };
    window.addEventListener("online", onOnline);
    return () => { rt.stop(); window.removeEventListener("online", onOnline); };
  }, [uid, reload, setStatus]);

  // Register this device so it appears in Settings > Devices.
  useEffect(() => {
    const deviceId = localStorage.getItem("nf.deviceId") ?? newStableId();
    localStorage.setItem("nf.deviceId", deviceId);
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    touchDevice(uid, deviceId, isMobile ? "Mobile browser" : "Web browser",
      isMobile ? "mobile" : "web").catch(() => {/* non-fatal */});
  }, [uid]);

  if (booting) return <BootSkeleton />;
  return (
    <div className="flex h-full min-h-0">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar status={status} onRetry={() => reload()} />
        <main className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
            <SafeRoute />
        </main>
      </div>
    </div>
  );
}

// Nested routes render through <Outlet/> directly.
function SafeRoute() { return <Outlet />; }

function BootSkeleton() {
  return (
    <div className="grid h-full place-items-center">
      <div className="w-full max-w-5xl space-y-4 p-6">
        <Skeleton h={40} w="30%"/>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} h={140}/>)}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sidebar + top bar                                                   */
/* ------------------------------------------------------------------ */
function Sidebar() {
  const { sidebarCollapsed, set } = useUI();
  const uid = useAuth((s) => s.userId)!;
  const cats = useData((s) => s.categories);
  const nav = useNavigate();
  return (
    <aside className={`hidden shrink-0 border-r border-[color:var(--nf-border)] bg-surface1 transition-[width] md:flex md:flex-col ${sidebarCollapsed?"w-16":"w-64"}`}>
      <div className={`flex items-center ${sidebarCollapsed?"justify-center":"justify-between"} p-3`}>
        {!sidebarCollapsed && <div className="font-semibold">NoteFlow</div>}
        <button className="nf-btn nf-btn-ghost !px-1.5" onClick={() => set({ sidebarCollapsed: !sidebarCollapsed })} aria-label="Toggle sidebar">
          <Menu size={16}/>
        </button>
      </div>
      <nav className="flex flex-col gap-0.5 px-2 text-sm">
        <SideLink to="/"       icon={<Home size={16}/>}       label="Home"        collapsed={sidebarCollapsed} onGo={() => nav("/")}/>
        <SideLink to="/archived" icon={<ArchiveIcon size={16}/>} label="Archived"   collapsed={sidebarCollapsed} onGo={() => nav("/archived")}/>
        <SideLink to="/categories" icon={<TagIcon size={16}/>}  label="Categories"  collapsed={sidebarCollapsed} onGo={() => nav("/categories")}/>
        <SideLink to="/widgets"  icon={<Monitor size={16}/>}    label="Widgets"     collapsed={sidebarCollapsed} onGo={() => nav("/widgets")}/>
        <SideLink to="/settings" icon={<SettingsIcon size={16}/>} label="Settings"  collapsed={sidebarCollapsed} onGo={() => nav("/settings")}/>
      </nav>
      {!sidebarCollapsed && (
        <div className="mt-3 px-3">
          <div className="text-[11px] uppercase tracking-wider text-subtle">Categories</div>
          <div className="mt-1 flex flex-col gap-0.5">
            {cats.map((c) => (
              <button key={c.id} className="truncate rounded px-2 py-1 text-left text-xs hover:bg-surface3 nf-focusable"
                onClick={() => { useFilter.getState().set({ category: c.id }); nav("/"); }}>
                <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: `var(--nf-accent)` }}/>
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="mt-auto p-3 text-[11px] text-subtle">
        {uid.slice(0, 8)}…
      </div>
    </aside>
  );
}
function SideLink({ to, icon, label, collapsed, onGo }:
  { to: string; icon: React.ReactNode; label: string; collapsed: boolean; onGo: () => void }) {
  const loc = useLocation();
  const active = loc.pathname === to;
  return (
    <button onClick={onGo}
      className={`nf-focusable flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${active?"bg-surface3 text-text":"text-muted hover:bg-surface2"}`}
      title={label}>
      {icon}{!collapsed && <span>{label}</span>}
    </button>
  );
}

function TopBar({ status, onRetry }: { status: SyncStatus; onRetry: () => void }) {
  const uid = useAuth((s) => s.userId)!;
  const nav = useNavigate();
  const set = useFilter((s) => s.set);
  const [q, setQ] = useState("");
  useDebouncedEffect(() => set({ query: q }), [q], 250);
  return (
    <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-[color:var(--nf-border)] bg-surface1/80 p-3 backdrop-blur">
      <Button kind="primary" icon={<Plus size={16}/>} onClick={() => nav("/notes/new")}>New note</Button>
      <form className="hidden flex-1 md:flex" onSubmit={(e) => e.preventDefault()}>
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search"/>
      </form>
      <div className="ml-auto flex items-center gap-1">
        <SyncBadge status={status} onRetry={onRetry}/>
        <ViewToggle/>
        <ThemeToggle/>
        <Button kind="ghost" icon={<LogOut size={16}/>} onClick={() => signOut()} aria-label="Sign out"/>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Auth pages                                                          */
/* ------------------------------------------------------------------ */
function AuthPage({ mode }: { mode: "login"|"signup"|"forgot"|"reset" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ kind: "err"|"ok"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      if (mode === "login") { await signIn(email, password); nav("/"); }
      if (mode === "signup") { await signUp(email, password, name || email.split("@")[0]!); setMsg({ kind: "ok", text: "Check your inbox to confirm, then sign in." }); }
      if (mode === "forgot") { await resetPassword(email); setMsg({ kind: "ok", text: "Reset link sent if the account exists." }); }
      if (mode === "reset")  { await updatePassword(password); setMsg({ kind: "ok", text: "Password updated." }); nav("/"); }
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto flex h-full max-w-md flex-col justify-center p-6">
      <div className="nf-panel p-6">
        <h1 className="mb-1 text-xl font-semibold">
          {mode==="login"?"Welcome back":mode==="signup"?"Create your account":mode==="forgot"?"Reset password":"Choose a new password"}
        </h1>
        <p className="mb-4 text-sm text-muted">
          {mode==="login"?"Sign in to sync your notes across devices":
           mode==="signup"?"Notes are private to your account (RLS enforced)":
           mode==="forgot"?"We'll email you a secure reset link":
           "Paste the link from your email, then set a new password."}
        </p>
        <form onSubmit={submit} className="space-y-3">
          {(mode==="signup") && (
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Display name</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60}/>
            </label>
          )}
          {mode!=="reset" && (
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Email</span>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required/>
            </label>
          )}
          {mode!=="forgot" && (
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Password</span>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8}/>
            </label>
          )}
          <Button kind="primary" type="submit" disabled={busy} className="w-full justify-center">
            {busy ? "Working…" : mode==="login"?"Sign in":mode==="signup"?"Create account":mode==="forgot"?"Send reset link":"Update password"}
          </Button>
        </form>
        {msg && <div className={`mt-3 text-sm ${msg.kind==="err"?"text-danger":"text-success"}`}>{msg.text}</div>}
        <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted">
          {mode==="login" && <>
            <Link className="hover:text-text" to="/signup">Create account</Link>
            <Link className="hover:text-text" to="/forgot">Forgot password?</Link>
          </>}
          {mode==="signup" && <Link className="hover:text-text" to="/login">I already have an account</Link>}
          {(mode==="forgot"||mode==="reset") && <Link className="hover:text-text" to="/login">Back to sign in</Link>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */
function DashboardPage() {
  const { notes, bundles, categories, tags } = useData();
  const f = useFilter();
  const uid = useAuth((s) => s.userId)!;
  const setStatus = useSync((s) => s.setStatus);
  const toast = useSync((s) => s.toast);
  const nav = useNavigate();
  const [dragId, setDragId] = useState<string | null>(null);
  const [quick, setQuick] = useState<{ open: boolean; title: string }>({ open: false, title: "" });

  const all = useMemo(() => Object.values(notes), [notes]);
  const filtered = useMemo(() => {
    const q = f.query.trim().toLowerCase();
    return all
      .filter((n) => !n.is_archived)
      .filter((n) => f.category==="all" || n.category_id===f.category)
      .filter((n) => f.color==="all" || n.color===f.color)
      .filter((n) => f.priority==="all" || n.priority===f.priority)
      .filter((n) => !f.pinned || n.is_pinned)
      .filter((n) => !f.overdue || isOverdue(n.due_at))
      .filter((n) => {
        if (!q) return true;
        const b = bundles[n.id];
        const inTitle = n.title.toLowerCase().includes(q);
        const inBody  = n.content.toLowerCase().includes(q);
        const inCheck = b?.checklist.some((c) => c.text.toLowerCase().includes(q));
        return inTitle || inBody || inCheck;
      })
      .sort((a, b) => (a.is_pinned === b.is_pinned ? a.sort_order - b.sort_order : a.is_pinned ? -1 : 1));
  }, [all, f, bundles]);

  const pinned = filtered.filter((n) => n.is_pinned);
  const recent = [...filtered].sort((a,b)=>Date.parse(b.updated_at)-Date.parse(a.updated_at)).slice(0, 6);
  const upcoming = all.filter((n) => n.reminder_at && !n.is_archived);
  const activeTasks = all.filter((n) => !n.is_archived && (bundles[n.id]?.checklist.length ?? 0) > 0);

  // Ctrl/Cmd+K opens search, Ctrl/Cmd+N creates a note.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); (document.querySelector<HTMLInputElement>("input[aria-label=Search]"))?.focus(); }
      if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); nav("/notes/new"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav]);

  const togglePin = async (n: Note) => {
    useData.getState().upsertNote({ ...n, is_pinned: !n.is_pinned }); // optimistic
    try { await upsertNote(uid, { ...n, is_pinned: !n.is_pinned } as unknown as NoteInput, n.version); }
    catch (err) { useData.getState().upsertNote(n); onError(err); }
  };
  const archive = async (n: Note) => {
    useData.getState().upsertNote({ ...n, is_archived: true });
    try { await upsertNote(uid, { ...n, is_archived: true } as unknown as NoteInput, n.version); }
    catch (err) { useData.getState().upsertNote(n); onError(err); }
  };
  const [confirmDel, setConfirmDel] = useState<Note | null>(null);
  const doDelete = async (n: Note) => {
    useData.getState().removeNote(n.id);
    try { await softDeleteNote(uid, n.id); toast("success", "Note deleted"); }
    catch (err) { useData.getState().upsertNote(n); onError(err); }
    setConfirmDel(null);
  };
  const onError = (err: unknown) => {
    const e = err instanceof ApiError ? err : new ApiError(String(err));
    if (e.isNetwork()) { toast("error", "Offline — changes queued"); setStatus("offline"); return; }
    toast("error", e.message);
  };

  const reorder = async (target: Note) => {
    if (!dragId || dragId === target.id) return;
    const cur = all.filter((n) => !n.is_archived);
    const from = cur.findIndex((n) => n.id === dragId);
    const to   = cur.findIndex((n) => n.id === target.id);
    if (from < 0 || to < 0) return;
    const next = [...cur]; const [mv] = next.splice(from, 1); next.splice(to, 0, mv);
    next.forEach((n, i) => useData.getState().upsertNote({ ...n, sort_order: i }));
    setDragId(null);
    for (let i = 0; i < next.length; i++) {
      const n = next[i]!;
      try { await upsertNote(uid, { ...n, sort_order: i } as unknown as NoteInput, n.version); }
      catch (err) { onError(err); return; }
    }
  };

  const quickAdd = async (title: string) => {
    const id = newStableId();
    const now = new Date().toISOString();
    const note: Note = {
      id, user_id: uid, category_id: null, title, content: "", color: "slate",
      priority: "normal", is_pinned: false, is_archived: false, sort_order: all.length,
      due_at: null, reminder_at: null, version: 1, created_at: now, updated_at: now, deleted_at: null,
    };
    useData.getState().upsertNote(note);
    try { await upsertNote(uid, note as unknown as NoteInput); }
    catch (err) {
      const e = err instanceof ApiError ? err : new ApiError(String(err));
      if (e.isNetwork()) { enqueue(uid, { kind:"upsert_note", note: note as unknown as NoteInput, expectedVersion: 1, idempotencyKey: makeKey("add", id) }); toast("info","Saved offline"); }
      else { useData.getState().removeNote(id); onError(err); }
    }
    setQuick({ open: false, title: "" });
    nav(`/notes/${id}`);
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <StatsBar total={all.length} tasks={activeTasks.length} reminders={upcoming.length}/>
      <QuickAdd open={quick.open} value={quick.title}
        onOpen={() => setQuick({ open: true, title: "" })}
        onChange={(v) => setQuick({ open: true, title: v })}
        onSubmit={() => quick.title.trim() && quickAdd(quick.title.trim())}
        onCancel={() => setQuick({ open: false, title: "" })} />
      <Filters/>

      <section>
        <SectionHeader title="Pinned" count={pinned.length} icon={<Pin size={14}/>} />
        {pinned.length === 0
          ? <EmptyState title="No pinned notes" hint="Pin a note from the card menu to keep it here."/>
          : <NoteGrid list={pinned} onOpen={(n)=>nav(`/notes/${n.id}`)} onPin={togglePin} onArchive={archive} onDelete={setConfirmDel}
              bundles={bundles} tags={tags}/>}
      </section>

      <section>
        <SectionHeader title="Recent" count={recent.length}/>
        <NoteGrid list={recent} onOpen={(n)=>nav(`/notes/${n.id}`)} onPin={togglePin} onArchive={archive} onDelete={setConfirmDel}
          bundles={bundles} tags={tags}/>
      </section>

      <section>
        <SectionHeader title="All notes" count={filtered.length}/>
        {filtered.length === 0
          ? <EmptyState title="No notes match your filters" hint="Try clearing search or filters." action={<Button kind="outline" onClick={()=>f.reset()}>Reset filters</Button>}/>
          : <div onDragOver={(e)=>e.preventDefault()} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((n) => (
                <div key={n.id}>
                  <NoteCard note={n}
                    checklist={bundles[n.id]?.checklist}
                    tags={(bundles[n.id]?.tag_ids ?? []).map((id) => tags.find((t)=>t.id===id)?.name).filter((x): x is string => !!x)}
                    onOpen={() => nav(`/notes/${n.id}`)}
                    onPin={() => togglePin(n)}
                    onArchive={() => archive(n)}
                    onDelete={() => setConfirmDel(n)}
                    draggable
                    onDragStart={() => setDragId(n.id)}
                    onDragEnd={() => reorder(n)}/>
                </div>
              ))}
            </div>}
      </section>

      <section>
        <SectionHeader title="Upcoming reminders" icon={<Bell size={14}/>}/>
        <RemindersList notes={upcoming}
          onSnooze={(id) => { const n = notes[id]; if (!n) return; const at = new Date(Date.now() + 3_600_000).toISOString();
            useData.getState().upsertNote({ ...n, reminder_at: at });
            upsertNote(uid, { ...n, reminder_at: at } as unknown as NoteInput, n.version).catch(onError); }}
          onComplete={(id) => { const n = notes[id]; if (!n) return;
            useData.getState().upsertNote({ ...n, reminder_at: null });
            upsertNote(uid, { ...n, reminder_at: null } as unknown as NoteInput, n.version).catch(onError); }}/>
      </section>

      <Confirm open={!!confirmDel} title="Delete this note?"
        body="The note is moved to trash. You can restore it from Archived."
        danger onConfirm={() => confirmDel && doDelete(confirmDel)} onCancel={() => setConfirmDel(null)}/>
    </div>
  );
}

function StatsBar({ total, tasks, reminders }: { total: number; tasks: number; reminders: number }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {[["Notes", total],["Active tasks", tasks],["Reminders", reminders]].map(([l,v]) => (
        <div key={l as string} className="nf-panel p-3">
          <div className="text-xs text-muted">{l}</div>
          <div className="text-2xl font-semibold">{v as number}</div>
        </div>
      ))}
    </div>
  );
}
function SectionHeader({ title, count, icon }: { title: string; count?: number; icon?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-sm">
      {icon}<h2 className="font-medium">{title}</h2>
      {typeof count === "number" && <span className="nf-chip">{count}</span>}
    </div>
  );
}
function QuickAdd({ open, value, onOpen, onChange, onSubmit, onCancel }:
  { open: boolean; value: string; onOpen: () => void; onChange: (v: string) => void; onSubmit: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  if (!open) return (
    <button onClick={onOpen}
      className="nf-panel flex w-full items-center gap-2 p-3 text-sm text-muted hover:text-text nf-focusable">
      <Plus size={16}/> Quick add — press to type a title (Enter saves)
    </button>
  );
  return (
    <form className="nf-panel flex items-center gap-2 p-2" onSubmit={(e)=>{e.preventDefault(); onSubmit();}}>
      <Input ref={ref} value={value} placeholder="Note title"
        onChange={(e) => onChange(e.target.value)} onKeyDown={(e)=>{ if(e.key==="Escape") onCancel(); }}/>
      <Button kind="primary" type="submit">Save</Button>
      <Button kind="ghost" type="button" onClick={onCancel} aria-label="Cancel"><X size={14}/></Button>
    </form>
  );
}
function Filters() {
  const f = useFilter();
  const cats = useData((s) => s.categories);
  return (
    <div className="nf-panel flex flex-wrap items-center gap-2 p-2 text-xs">
      <select className="nf-select !w-auto" value={f.category} onChange={(e)=>f.set({ category: e.target.value as never })}>
        <option value="all">All categories</option>
        {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select className="nf-select !w-auto" value={f.color} onChange={(e)=>f.set({ color: e.target.value as never })}>
        <option value="all">Any color</option>
        {NOTE_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <select className="nf-select !w-auto" value={f.priority} onChange={(e)=>f.set({ priority: e.target.value as never })}>
        <option value="all">Any priority</option>
        {["low","normal","high","urgent"].map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <label className="ml-2 flex items-center gap-1"><input type="checkbox" checked={f.pinned} onChange={(e)=>f.set({ pinned: e.target.checked })}/>Pinned</label>
      <label className="flex items-center gap-1"><input type="checkbox" checked={f.overdue} onChange={(e)=>f.set({ overdue: e.target.checked })}/>Overdue</label>
      <Button kind="ghost" onClick={f.reset} className="ml-auto">Clear</Button>
    </div>
  );
}
function NoteGrid({ list, bundles, tags, onOpen, onPin, onArchive, onDelete }:
  { list: Note[]; bundles: ReturnType<typeof useData.getState>["bundles"]; tags: ReturnType<typeof useData.getState>["tags"];
    onOpen: (n: Note) => void; onPin: (n: Note) => void; onArchive: (n: Note) => void; onDelete: (n: Note) => void }) {
  const view = useUI((s) => s.view);
  if (list.length === 0) return null;
  const gridCls = view === "grid" ? "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" : "flex flex-col gap-2";
  return (
    <div className={gridCls}>
      {list.map((n) => (
        <NoteCard key={n.id} note={n}
          checklist={bundles[n.id]?.checklist}
          tags={(bundles[n.id]?.tag_ids ?? []).map((id)=>tags.find((t)=>t.id===id)?.name).filter((x): x is string => !!x)}
          onOpen={() => onOpen(n)} onPin={() => onPin(n)} onArchive={() => onArchive(n)} onDelete={() => onDelete(n)}/>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Note editor                                                         */
/* ------------------------------------------------------------------ */
function NoteEditorPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const uid = useAuth((s) => s.userId)!;
  const { notes, bundles, categories, tags } = useData();
  const toast = useSync((s) => s.toast);
  const setStatus = useSync((s) => s.setStatus);
  const isNew = id === "new";
  const existing = isNew ? null : notes[id!];
  if (!isNew && !existing) return <EmptyState title="Note not found" action={<Button kind="outline" onClick={()=>nav("/")}>Back</Button>}/>;

  const [draft, setDraft] = useState<Note>(() => existing ?? blankNote(uid, "slate"));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState<"idle"|"saving"|"saved"|"error">("idle");
  useEffect(() => { if (existing) setDraft(existing); /* on live update from realtime, adopt server if we're not editing */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.version, existing?.updated_at]);

  const commit = useCallback(async (n: Note, opts: { retry?: boolean } = {}) => {
    setSaving("saving");
    const expected = existing?.version;
    try {
      const saved = await upsertNote(uid, n as unknown as NoteInput, expected);
      useData.getState().upsertNote(saved);
      setDraft(saved); setDirty(false); setSaving("saved");
      setTimeout(() => setSaving("idle"), 1500);
      if (isNew) nav(`/notes/${saved.id}`, { replace: true });
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError(String(err));
      if (e.isConflict() && !opts.retry) {
        const server = (err as ApiError & { server?: Note | null }).server ?? null;
        const r = reconcileNote(n, server, expected ?? 1, new Date().toISOString());
        if (r.kind === "deleted_on_server") { toast("error", r.message); nav("/"); return; }
        setDraft(r.resolved as Note);
        if (r.needsRetry) { await commit(r.resolved as Note, { retry: true }); }
        toast("info", r.message);
        return;
      }
      if (e.isNetwork()) {
        enqueue(uid, { kind: "upsert_note", note: n as unknown as NoteInput, expectedVersion: n.version, idempotencyKey: makeKey("edit", n.id) });
        setSaving("error"); setStatus("offline"); toast("info", "Offline — will sync when connection returns");
      } else {
        setSaving("error"); setStatus("error"); toast("error", e.message);
      }
    }
  }, [uid, existing?.version, isNew, nav, setStatus, toast]);

  useDebouncedEffect(() => { if (dirty) commit(draft); }, [draft, dirty], 800);

  const update = (patch: Partial<Note>) => { setDraft((d) => ({ ...d, ...patch })); setDirty(true); };
  const [confirmDelete, setConfirmDelete] = useState(false);

  const addChecklist = async (text: string) => {
    const item = { id: newStableId(), note_id: draft.id, user_id: uid, text, is_completed: false,
      sort_order: (bundles[draft.id]?.checklist.length ?? 0), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    useData.getState().upsertChecklist(item);
    try { await upsertChecklistItem(uid, draft.id, item); } catch (err) { toast("error", String((err as Error).message)); }
  };
  const toggleChecklist = async (cid: string, done: boolean) => {
    const cur = bundles[draft.id]?.checklist.find((c) => c.id === cid); if (!cur) return;
    const next = { ...cur, is_completed: done };
    useData.getState().upsertChecklist(next);
    try { await upsertChecklistItem(uid, draft.id, next); } catch (err) { toast("error", String((err as Error).message)); }
  };
  const removeChecklist = async (cid: string) => {
    useData.getState().removeChecklist(cid);
    try { await deleteChecklistItem(uid, cid); } catch (err) { toast("error", String((err as Error).message)); }
  };

  const [tagPicker, setTagPicker] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const attachTag = async (tagId: string) => {
    const ids = Array.from(new Set([...(bundles[draft.id]?.tag_ids ?? []), tagId]));
    useData.getState().bundles[draft.id] ??= { checklist: [], tag_ids: [] };
    useData.setState({ bundles: { ...bundles, [draft.id]: { ...(bundles[draft.id] ?? { checklist: [] }), tag_ids: ids } } });
    try { await assignTags(uid, draft.id, ids); } catch (err) { toast("error", String((err as Error).message)); }
    setTagPicker(false);
  };
  const detachTag = async (tagId: string) => {
    const ids = (bundles[draft.id]?.tag_ids ?? []).filter((t) => t !== tagId);
    useData.setState({ bundles: { ...bundles, [draft.id]: { ...(bundles[draft.id] ?? { checklist: [] }), tag_ids: ids } } });
    try { await assignTags(uid, draft.id, ids); } catch (err) { toast("error", String((err as Error).message)); }
  };
  const createAndAttachTag = async (name: string) => {
    const id = newStableId();
    const row = { id, user_id: uid, name, color: null, created_at: new Date().toISOString() };
    await supabase.from("note_tags").insert(row);
    useData.getState().upsertTag(row);
    attachTag(id);
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <Button kind="ghost" onClick={() => nav(-1)}>← Back</Button>
        <div className="flex items-center gap-2 text-xs">
          {saving==="saving" && <span className="inline-flex items-center gap-1 text-info"><Save size={14}/>Saving…</span>}
          {saving==="saved"  && <span className="inline-flex items-center gap-1 text-success"><Save size={14}/>Saved</span>}
          {saving==="error"  && <span className="inline-flex items-center gap-1 text-danger"><Save size={14}/>Save failed</span>}
          {dirty && saving==="idle" && <span className="text-muted">Unsaved…</span>}
        </div>
        <div className="flex items-center gap-1">
          <Button kind="ghost" onClick={() => update({ is_pinned: !draft.is_pinned })}>{draft.is_pinned ? "Unpin" : "Pin"}</Button>
          <Button kind="ghost" onClick={() => { update({ is_archived: true }); }} disabled={draft.is_archived}>Archive</Button>
          <Button kind="ghost" icon={<Trash2 size={14}/>} onClick={() => setConfirmDelete(true)} aria-label="Delete"/>
        </div>
      </div>

      <Input value={draft.title} placeholder="Untitled"
        onChange={(e) => update({ title: e.target.value })} maxLength={200}
        className="!text-2xl !font-semibold !bg-transparent !border-0 focus:!ring-0"/>
      <Textarea value={draft.content} placeholder="Start typing…"
        onChange={(e) => update({ content: e.target.value })}
        className="!bg-transparent !border-0 min-h-[300px] focus:!ring-0"/>

      <div className="nf-panel space-y-4 p-4">
        <div>
          <div className="mb-1 text-xs text-muted">Color</div>
          <ColorSwatches value={draft.color} onChange={(color) => update({ color })}/>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs">
            <span className="mb-1 block text-muted">Category</span>
            <select className="nf-select" value={draft.category_id ?? ""}
              onChange={(e) => update({ category_id: e.target.value || null })}>
              <option value="">None</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="block text-xs">
            <span className="mb-1 block text-muted">Priority</span>
            <PriorityPicker value={draft.priority} onChange={(priority) => update({ priority })}/>
          </label>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="block text-xs">
            <span className="mb-1 flex items-center gap-1 text-muted"><Calendar size={12}/>Due</span>
            <DateTimeLocal value={draft.due_at} onChange={(due_at) => update({ due_at })}/>
          </label>
          <label className="block text-xs">
            <span className="mb-1 flex items-center gap-1 text-muted"><Bell size={12}/>Reminder</span>
            <DateTimeLocal value={draft.reminder_at} onChange={(reminder_at) => update({ reminder_at })}/>
          </label>
        </div>

        <div>
          <div className="mb-1 text-xs text-muted">Tags</div>
          <div className="flex flex-wrap items-center gap-1">
            {(bundles[draft.id]?.tag_ids ?? []).map((tid) => {
              const t = tags.find((x) => x.id === tid); if (!t) return null;
              return <span key={tid} className="nf-chip">
                {t.name}<button className="ml-1 hover:text-danger" onClick={()=>detachTag(tid)} aria-label="Remove tag"><X size={10}/></button>
              </span>;
            })}
            <button className="nf-btn nf-btn-ghost !px-2" onClick={()=>setTagPicker(true)}><Plus size={12}/>Add tag</button>
          </div>
        </div>

        <div>
          <div className="mb-1 text-xs text-muted">Checklist</div>
          <Checklist items={bundles[draft.id]?.checklist ?? []}
            onAdd={addChecklist} onToggle={toggleChecklist} onRemove={removeChecklist}/>
        </div>

        <div className="flex justify-between text-[11px] text-subtle">
          <span>Created {new Date(draft.created_at).toLocaleString()}</span>
          <span>Updated {relTime(draft.updated_at)} · v{draft.version}</span>
        </div>
      </div>

      <Modal open={tagPicker} onClose={()=>setTagPicker(false)} title="Add tag">
        <Input autoFocus placeholder="Search or create…" value={tagSearch}
          onChange={(e) => setTagSearch(e.target.value)}/>
        <div className="mt-3 flex max-h-64 flex-col gap-1 overflow-auto">
          {tags
            .filter((t) => t.name.toLowerCase().includes(tagSearch.toLowerCase()))
            .map((t) => <button key={t.id} className="nf-btn nf-btn-ghost justify-start" onClick={()=>attachTag(t.id)}>{t.name}</button>)}
          {tagSearch.trim() && !tags.some((t)=>t.name.toLowerCase()===tagSearch.toLowerCase()) && (
            <Button kind="primary" onClick={() => createAndAttachTag(tagSearch.trim())}>Create "{tagSearch.trim()}"</Button>
          )}
        </div>
      </Modal>

      <Confirm open={confirmDelete} title="Delete this note?" danger
        body="Moved to trash. You can restore it from Archived."
        onConfirm={async () => { setConfirmDelete(false);
          try { await softDeleteNote(uid, draft.id); useData.getState().removeNote(draft.id); nav("/"); }
          catch (err) { toast("error", String((err as Error).message)); } }}
        onCancel={() => setConfirmDelete(false)}/>
    </div>
  );
}

function blankNote(uid: string, color: NoteColor): Note {
  const now = new Date().toISOString();
  return { id: newStableId(), user_id: uid, category_id: null, title: "", content: "", color,
    priority: "normal", is_pinned: false, is_archived: false, sort_order: 0,
    due_at: null, reminder_at: null, version: 1, created_at: now, updated_at: now, deleted_at: null };
}
const Calendar = Icons.Calendar as React.FC<{ size?: number }>;

/* ------------------------------------------------------------------ */
/* Archived                                                            */
/* ------------------------------------------------------------------ */
function ArchivedPage() {
  const { notes, bundles, tags } = useData();
  const nav = useNavigate();
  const uid = useAuth((s) => s.userId)!;
  const toast = useSync((s) => s.toast);
  const list = Object.values(notes).filter((n) => n.is_archived);
  const restore = async (n: Note) => {
    useData.getState().upsertNote({ ...n, is_archived: false });
    try { await upsertNote(uid, { ...n, is_archived: false } as unknown as NoteInput, n.version); }
    catch (err) { toast("error", String((err as Error).message)); }
  };
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <h1 className="text-lg font-semibold">Archived</h1>
      {list.length === 0 ? <EmptyState title="Nothing archived"/> : (
        <NoteGrid list={list} bundles={bundles} tags={tags}
          onOpen={(n)=>nav(`/notes/${n.id}`)} onPin={()=>{}} onArchive={restore} onDelete={()=>{}}/>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Categories page                                                     */
/* ------------------------------------------------------------------ */
function CategoriesPage() {
  const cats = useData((s) => s.categories);
  const uid = useAuth((s) => s.userId)!;
  const toast = useSync((s) => s.toast);
  const [edit, setEdit] = useState<Category | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<NoteColor>("slate");
  const [confirm, setConfirm] = useState<Category | null>(null);
  const [moveTo, setMoveTo] = useState<string>("");

  const startAdd = () => { setEdit({ id: "", user_id: uid, name: "", color: "slate", sort_order: cats.length, created_at: "", updated_at: "" }); setName(""); setColor("slate"); };
  const save = async () => {
    if (!edit) return;
    try {
      const saved = await upsertCategory(uid, { id: edit.id || undefined, name, color, sort_order: edit.sort_order });
      useData.getState().upsertCategory(saved as Category);
      setEdit(null);
    } catch (err) { toast("error", String((err as Error).message)); }
  };
  const doDelete = async () => {
    if (!confirm) return;
    try { await deleteCategory(uid, confirm.id, moveTo || null);
      useData.setState({ categories: cats.filter((c)=>c.id!==confirm.id) });
      toast("success", "Category removed");
    } catch (err) { toast("error", String((err as Error).message)); }
    setConfirm(null); setMoveTo("");
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Categories</h1>
        <Button kind="primary" onClick={startAdd}><Plus size={14}/>New</Button>
      </div>
      <div className="nf-panel divide-y divide-[color:var(--nf-border)]">
        {cats.map((c) => (
          <div key={c.id} className="flex items-center justify-between p-3">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--nf-accent)" }}/>
              <span className="text-sm">{c.name}</span>
            </div>
            <div className="flex gap-1">
              <Button kind="ghost" onClick={() => { setEdit(c); setName(c.name); setColor(c.color); }}>Rename</Button>
              <Button kind="ghost" onClick={() => setConfirm(c)}><Trash2 size={14}/></Button>
            </div>
          </div>
        ))}
      </div>

      <Modal open={!!edit} onClose={()=>setEdit(null)} title={edit?.id ? "Edit category" : "New category"} size="sm">
        <div className="space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" maxLength={60}/>
          <ColorSwatches value={color} onChange={setColor}/>
          <div className="flex justify-end gap-2"><Button kind="ghost" onClick={()=>setEdit(null)}>Cancel</Button><Button kind="primary" onClick={save}>Save</Button></div>
        </div>
      </Modal>

      <Confirm open={!!confirm} title="Delete category"
        body={`Notes in "${confirm?.name}" will be moved to the target category (or uncategorized).`}
        danger onConfirm={doDelete} onCancel={() => setConfirm(null)}/>
      {confirm && (
        <div className="mt-2 flex gap-2">
          <select className="nf-select" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
            <option value="">Uncategorized</option>
            {cats.filter((c) => c.id !== confirm.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Widget manager                                                      */
/* ------------------------------------------------------------------ */
function WidgetManagerPage() {
  const { notes, widgetPrefs } = useData();
  const uid = useAuth((s) => s.userId)!;
  const toast = useSync((s) => s.toast);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<WidgetPreference | null>(null);

  const create = async (noteId: string) => {
    try {
      const saved = await upsertWidgetPref(uid, {
        note_id: noteId, widget_order: widgetPrefs.length, width: 320, height: 260, opacity: 0.92,
        preferred_position: { x: 120, y: 120, monitor: null }, is_visible: true,
        is_always_on_top: true, expanded: true, show_on_startup: true,
      });
      useData.getState().upsertWidgetPref(saved as WidgetPreference);
      setAddOpen(false);
    } catch (err) { toast("error", String((err as Error).message)); }
  };
  const patch = async (w: WidgetPreference) => {
    try { const s = await upsertWidgetPref(uid, { ...w, id: w.id }); useData.getState().upsertWidgetPref(s as WidgetPreference); }
    catch (err) { toast("error", String((err as Error).message)); }
  };
  const remove = async (w: WidgetPreference) => {
    useData.setState({ widgetPrefs: widgetPrefs.filter((x)=>x.id!==w.id) });
    try { await deleteWidgetPref(uid, w.id); } catch (err) { toast("error", String((err as Error).message)); }
  };
  const move = async (w: WidgetPreference, dir: -1 | 1) => {
    const sorted = [...widgetPrefs].sort((a,b)=>a.widget_order-b.widget_order);
    const idx = sorted.findIndex((x)=>x.id===w.id); const j = idx + dir;
    if (j < 0 || j >= sorted.length) return;
    const a = sorted[idx]!, b = sorted[j]!;
    const tmp = a.widget_order;
    await patch({ ...a, widget_order: b.widget_order });
    await patch({ ...b, widget_order: tmp });
  };

  const unattached = Object.values(notes).filter((n) => !n.is_archived && !widgetPrefs.some((w)=>w.note_id===n.id));

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Desktop widgets</h1>
        <Button kind="primary" onClick={() => setAddOpen(true)}><Plus size={14}/>Add widget</Button>
      </div>
      <p className="text-xs text-muted">Widgets are native Windows windows (via Tauri) that display a single note. Configure here, the desktop app picks up changes in real time.</p>
      <div className="space-y-2">
        {widgetPrefs.length === 0 ? <EmptyState title="No widgets yet" hint="Add one to see a note on your desktop."/> :
          widgetPrefs.map((w) => (
            <WidgetRow key={w.id} pref={w} note={notes[w.note_id]}
              onEdit={() => setEditing(w)}
              onToggleVisible={() => patch({ ...w, is_visible: !w.is_visible })}
              onDelete={() => remove(w)}
              onMoveUp={() => move(w, -1)} onMoveDown={() => move(w, 1)}/>
          ))}
      </div>

      <Modal open={addOpen} onClose={()=>setAddOpen(false)} title="Pick a note for a new widget">
        <div className="flex max-h-80 flex-col gap-1 overflow-auto">
          {unattached.map((n) => <button key={n.id} className="nf-btn nf-btn-ghost justify-start" onClick={()=>create(n.id)}>{n.title || "Untitled"}</button>)}
          {unattached.length === 0 && <EmptyState title="Every note already has a widget"/>}
        </div>
      </Modal>

      {editing && <EditWidget pref={editing} onClose={()=>setEditing(null)} onSave={async (w) => { await patch(w); setEditing(null); }}/>}
    </div>
  );
}
function EditWidget({ pref, onClose, onSave }: { pref: WidgetPreference; onClose: () => void; onSave: (w: WidgetPreference) => void }) {
  const [w, setW] = useState(pref);
  const num = (v: string) => parseInt(v || "0", 10);
  return (
    <Modal open onClose={onClose} title="Widget settings">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label>Width<Input type="number" value={w.width} onChange={(e)=>setW({ ...w, width: num(e.target.value) })}/></label>
        <label>Height<Input type="number" value={w.height} onChange={(e)=>setW({ ...w, height: num(e.target.value) })}/></label>
        <label>X<Input type="number" value={w.preferred_position.x} onChange={(e)=>setW({ ...w, preferred_position: { ...w.preferred_position, x: num(e.target.value) } })}/></label>
        <label>Y<Input type="number" value={w.preferred_position.y} onChange={(e)=>setW({ ...w, preferred_position: { ...w.preferred_position, y: num(e.target.value) } })}/></label>
        <label className="col-span-2">Opacity {Math.round(w.opacity*100)}%
          <input type="range" min={0.4} max={1} step={0.02} value={w.opacity} onChange={(e)=>setW({ ...w, opacity: parseFloat(e.target.value) })}/>
        </label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={w.is_always_on_top} onChange={(e)=>setW({ ...w, is_always_on_top: e.target.checked })}/>Always on top</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={w.show_on_startup} onChange={(e)=>setW({ ...w, show_on_startup: e.target.checked })}/>Show on startup</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={w.expanded} onChange={(e)=>setW({ ...w, expanded: e.target.checked })}/>Expanded (vs compact)</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={w.is_visible} onChange={(e)=>setW({ ...w, is_visible: e.target.checked })}/>Visible</label>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button kind="ghost" onClick={onClose}>Cancel</Button>
        <Button kind="primary" onClick={()=>onSave(w)}>Save</Button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */
function SettingsPage() {
  const { userId, email, displayName, setSession } = useAuth();
  const ui = useUI();
  const [name, setName] = useState(displayName);
  const [devices, setDevices] = useState<{ id:string; device_name:string; device_type:string; last_seen_at:string }[]>([]);
  const toast = useSync((s) => s.toast);
  const all = useData.getState().bundles;
  useEffect(() => {
    supabase.from("device_preferences").select("id,device_name,device_type,last_seen_at").eq("user_id", userId!)
      .then(({ data, error }) => { if (error) toast("error", error.message); else setDevices((data ?? []) as never); });
  }, [userId, toast]);
  const saveName = async () => {
    const { error } = await supabase.from("profiles").update({ display_name: name }).eq("id", userId!);
    if (error) toast("error", error.message); else { setSession(userId, email, name); toast("success", "Profile updated"); }
  };
  const doExport = async () => {
    const notes = Object.values(useData.getState().notes).map((n) => ({
      note: n, checklist: all[n.id]?.checklist ?? [], tag_ids: all[n.id]?.tag_ids ?? [],
    }));
    const { exportJSON } = await import("./lib");
    exportJSON({ notes, categories: useData.getState().categories, tags: useData.getState().tags });
  };
  const doImport = async (file: File) => {
    const { importJSON } = await import("./lib");
    try { await importJSON(file, userId!, () => toast("success", "Import complete")); }
    catch (err) { toast("error", String((err as Error).message)); }
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <h1 className="text-lg font-semibold">Settings</h1>
      <section className="nf-panel space-y-3 p-4">
        <h2 className="text-sm font-medium">Profile</h2>
        <div className="text-xs text-muted">{email}</div>
        <div className="flex gap-2"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60}/><Button kind="primary" onClick={saveName}>Save</Button></div>
      </section>
      <section className="nf-panel space-y-3 p-4">
        <h2 className="text-sm font-medium">Appearance</h2>
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="flex items-center gap-2">Theme
            <select className="nf-select !w-auto" value={ui.theme} onChange={(e)=>ui.set({ theme: e.target.value as never })}>
              <option value="dark">Dark</option><option value="light">Light</option>
            </select></label>
          <label className="flex items-center gap-2">Reduced motion
            <input type="checkbox" checked={ui.reducedMotion} onChange={(e)=>ui.set({ reducedMotion: e.target.checked })}/></label>
          <label className="flex items-center gap-2">Default note color
            <select className="nf-select !w-auto" value={ui.defaultNoteColor} onChange={(e)=>ui.set({ defaultNoteColor: e.target.value as NoteColor })}>
              {NOTE_COLORS.map((c)=><option key={c} value={c}>{c}</option>)}</select></label>
        </div>
      </section>
      <section className="nf-panel space-y-3 p-4">
        <h2 className="text-sm font-medium">Desktop widgets</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={ui.defaultWidgetAlwaysOnTop} onChange={(e)=>ui.set({ defaultWidgetAlwaysOnTop: e.target.checked })}/>
          New widgets default to always-on-top
        </label>
        <p className="text-xs text-muted">Reminder notifications: on desktop, the Tauri app uses native Windows notifications. On mobile, browser push requires installing the PWA and granting notification permission.</p>
      </section>
      <section className="nf-panel space-y-2 p-4">
        <h2 className="text-sm font-medium">Devices</h2>
        <ul className="space-y-1 text-sm">
          {devices.map((d) => (
            <li key={d.id} className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2">{d.device_type==="mobile"?<Smartphone size={14}/>:d.device_type==="desktop"?<Monitor size={14}/>:<LayoutDashboard size={14}/>}{d.device_name}</span>
              <span className="text-xs text-muted">{relTime(d.last_seen_at)}</span>
            </li>
          ))}
          {devices.length === 0 && <li className="text-xs text-muted">No devices seen yet.</li>}
        </ul>
      </section>
      <section className="nf-panel space-y-2 p-4">
        <h2 className="text-sm font-medium">Export & import</h2>
        <div className="flex gap-2">
          <Button kind="outline" onClick={doExport}>Export JSON</Button>
          <label className="nf-btn nf-btn-outline cursor-pointer">
            Import JSON
            <input type="file" accept="application/json" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.currentTarget.value = ""; }}/>
          </label>
        </div>
        <p className="text-xs text-muted">Import validates the schema and creates new note IDs; it does not overwrite existing notes.</p>
      </section>
      <section className="nf-panel space-y-2 p-4">
        <h2 className="text-sm font-medium">Privacy & session</h2>
        <p className="text-xs text-muted">Notes are protected by Row Level Security: only you can read or write them. Local cache is limited to your notes and is cleared on sign-out.</p>
        <div className="flex gap-2">
          <Button kind="danger" onClick={async () => {
            useData.getState().reset(); if (userId) { const { clearCache, clearQueue } = await import("./lib"); clearCache(userId); clearQueue(userId); }
            await signOut();
          }}>Sign out (clear local cache)</Button>
        </div>
      </section>
    </div>
  );
}
