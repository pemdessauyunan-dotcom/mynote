/**
 * NoteFlow web :: store.ts
 * All Zustand slices in one file for compactness. Each slice is a
 * small, focused concern: session, UI prefs, data, sync status.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  Note, NoteBundle, Category, NoteTag, NoteChecklistItem,
  WidgetPreference, SyncStatus, NoteInput, Priority, NoteColor,
} from "@noteflow/shared";

/* ------------------------------------------------------------------ */
/* UI preferences (theme, sidebar, defaults) - persisted to localStorage */
/* ------------------------------------------------------------------ */
export interface UIPrefs {
  theme: "dark" | "light";
  reducedMotion: boolean;
  sidebarCollapsed: boolean;
  view: "grid" | "list";
  defaultNoteColor: NoteColor;
  defaultWidgetAlwaysOnTop: boolean;
}
interface UIState extends UIPrefs {
  set: (p: Partial<UIPrefs>) => void;
}
export const useUI = create<UIState>()(persist(
  (set) => ({
    theme: "dark", reducedMotion: false, sidebarCollapsed: false,
    view: "grid", defaultNoteColor: "slate", defaultWidgetAlwaysOnTop: true,
    set: (p) => set(p),
  }),
  { name: "nf.ui", storage: createJSONStorage(() => localStorage) },
));

/* ------------------------------------------------------------------ */
/* Auth / session                                                      */
/* ------------------------------------------------------------------ */
interface AuthState {
  userId: string | null;
  email: string | null;
  displayName: string;
  loading: boolean;
  setSession: (u: string | null, e: string | null, name?: string) => void;
  setLoading: (v: boolean) => void;
}
export const useAuth = create<AuthState>((set) => ({
  userId: null, email: null, displayName: "", loading: true,
  setSession: (userId, email, displayName = "") => set({ userId, email, displayName, loading: false }),
  setLoading: (loading) => set({ loading }),
}));

/* ------------------------------------------------------------------ */
/* Data store: notes + related                                         */
/* ------------------------------------------------------------------ */
interface DataState {
  notes: Record<string, Note>;
  bundles: Record<string, { checklist: NoteChecklistItem[]; tag_ids: string[] }>;
  categories: Category[];
  tags: NoteTag[];
  widgetPrefs: WidgetPreference[];
  hydrated: boolean;
  hydrate: (d: {
    notes: Note[]; categories: Category[]; tags: NoteTag[];
    bundles: Record<string, NoteBundle>; widgetPrefs: WidgetPreference[];
  }) => void;
  upsertNote: (n: Note) => void;
  removeNote: (id: string) => void;
  upsertChecklist: (c: NoteChecklistItem) => void;
  removeChecklist: (id: string) => void;
  upsertCategory: (c: Category) => void;
  upsertTag: (t: NoteTag) => void;
  assignTag: (a: { note_id: string; tag_id: string }) => void;
  unassignTag: (a: { note_id: string; tag_id: string }) => void;
  upsertWidgetPref: (w: WidgetPreference) => void;
  reset: () => void;
}

const emptyData = {
  notes: {} as Record<string, Note>,
  bundles: {} as DataState["bundles"],
  categories: [] as Category[],
  tags: [] as NoteTag[],
  widgetPrefs: [] as WidgetPreference[],
  hydrated: false,
};

export const useData = create<DataState>((set) => ({
  ...emptyData,
  hydrate: ({ notes, categories, tags, bundles, widgetPrefs }) => set({
    notes: Object.fromEntries(notes.map((n) => [n.id, n])),
    bundles: Object.fromEntries(Object.entries(bundles).map(([k, v]) =>
      [k, { checklist: v.checklist, tag_ids: v.tag_ids }])),
    categories, tags, widgetPrefs, hydrated: true,
  }),
  upsertNote: (n) => set((s) => ({
    notes: { ...s.notes, [n.id]: n },
    bundles: { ...s.bundles, [n.id]: s.bundles[n.id] ?? { checklist: [], tag_ids: [] } },
  })),
  removeNote: (id) => set((s) => {
    const notes = { ...s.notes }; delete notes[id];
    const bundles = { ...s.bundles }; delete bundles[id];
    return { notes, bundles };
  }),
  upsertChecklist: (c) => set((s) => {
    const b = s.bundles[c.note_id] ?? { checklist: [], tag_ids: [] };
    const checklist = [...b.checklist.filter((x) => x.id !== c.id), c]
      .sort((a, z) => a.sort_order - z.sort_order);
    return { bundles: { ...s.bundles, [c.note_id]: { ...b, checklist } } };
  }),
  removeChecklist: (id) => set((s) => {
    const out = { ...s.bundles };
    for (const [k, v] of Object.entries(out)) {
      const next = v.checklist.filter((c) => c.id !== id);
      if (next.length !== v.checklist.length) out[k] = { ...v, checklist: next };
    }
    return { bundles: out };
  }),
  upsertCategory: (c) => set((s) => {
    const exists = s.categories.some((x) => x.id === c.id);
    return { categories: exists ? s.categories.map((x) => x.id === c.id ? c : x)
                                : [...s.categories, c].sort((a,b)=>a.sort_order-b.sort_order) };
  }),
  upsertTag: (t) => set((s) => ({
    tags: s.tags.some((x) => x.id === t.id) ? s.tags.map((x) => x.id === t.id ? t : x) : [...s.tags, t],
  })),
  assignTag: ({ note_id, tag_id }) => set((s) => {
    const b = s.bundles[note_id] ?? { checklist: [], tag_ids: [] };
    if (b.tag_ids.includes(tag_id)) return {};
    return { bundles: { ...s.bundles, [note_id]: { ...b, tag_ids: [...b.tag_ids, tag_id] } } };
  }),
  unassignTag: ({ note_id, tag_id }) => set((s) => {
    const b = s.bundles[note_id]; if (!b) return {};
    return { bundles: { ...s.bundles, [note_id]: { ...b, tag_ids: b.tag_ids.filter((x) => x !== tag_id) } } };
  }),
  upsertWidgetPref: (w) => set((s) => {
    const exists = s.widgetPrefs.some((x) => x.id === w.id);
    const list = exists ? s.widgetPrefs.map((x) => x.id === w.id ? w : x) : [...s.widgetPrefs, w];
    return { widgetPrefs: list.sort((a, b) => a.widget_order - b.widget_order) };
  }),
  reset: () => set({ ...emptyData }),
}));

/* ------------------------------------------------------------------ */
/* Sync status + toasts                                                */
/* ------------------------------------------------------------------ */
interface SyncState {
  status: SyncStatus;
  setStatus: (s: SyncStatus) => void;
  toasts: { id: string; kind: "info"|"success"|"error"; message: string }[];
  toast: (kind: "info"|"success"|"error", message: string) => void;
  dismiss: (id: string) => void;
}
export const useSync = create<SyncState>((set) => ({
  status: "offline",
  setStatus: (status) => set({ status }),
  toasts: [],
  toast: (kind, message) => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 5000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/* ------------------------------------------------------------------ */
/* Filter + search state (not persisted)                               */
/* ------------------------------------------------------------------ */
interface FilterState {
  query: string;
  category: string | "all";
  color: NoteColor | "all";
  priority: Priority | "all";
  pinned: boolean;
  archived: boolean;
  overdue: boolean;
  completed: boolean;
  set: (p: Partial<FilterState>) => void;
  reset: () => void;
}
const emptyFilter = {
  query: "", category: "all" as const, color: "all" as const, priority: "all" as const,
  pinned: false, archived: false, overdue: false, completed: false,
};
export const useFilter = create<FilterState>((set) => ({
  ...emptyFilter,
  set: (p) => set(p),
  reset: () => set({ ...emptyFilter }),
}));

export type { NoteInput };
