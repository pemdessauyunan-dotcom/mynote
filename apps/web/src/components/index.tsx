/**
 * NoteFlow web :: components.tsx
 * UI primitives + note-card/editor components. Consolidated into
 * one file so the whole product slice stays reviewable in one read.
 */
import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  X, Pin, PinOff, Check, Plus, Trash2, Archive, Search, Settings,
  LayoutGrid, List, Sun, Moon, Wifi, WifiOff, RefreshCw, Loader2,
  Tag as TagIcon, Bell, Calendar, ChevronLeft, ChevronRight,
} from "lucide-react";
import type {
  Note, NoteColor, NoteChecklistItem, Priority, WidgetPreference, SyncStatus,
} from "@noteflow/shared";
import { NOTE_COLORS, PRIORITIES, NOTE_COLOR_TOKENS } from "@noteflow/shared";
import { useUI } from "../store";

/* ---------------- Motion wrapper that respects reduced motion ------- */
export const M = motion;
export const useReducedMotion = () => {
  const rm = useUI((s) => s.reducedMotion);
  const media = typeof matchMedia === "function"
    ? matchMedia("(prefers-reduced-motion: reduce)").matches : false;
  return rm || media;
};

/* ---------------- Button ------------------------------------------- */
type BtnKind = "primary" | "ghost" | "outline" | "danger";
export function Button({
  kind = "outline", icon, children, className = "", ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: BtnKind; icon?: React.ReactNode }) {
  const kcls = kind === "primary" ? "nf-btn-primary"
    : kind === "ghost" ? "nf-btn-ghost"
    : kind === "danger" ? "nf-btn-danger" : "nf-btn-outline";
  return (
    <button className={`nf-btn ${kcls} ${className}`} {...rest}>
      {icon}{children}
    </button>
  );
}

/* ---------------- Input / Textarea / Select ------------------------ */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className = "", ...p }, ref) => <input ref={ref} className={`nf-input ${className}`} {...p} />);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className = "", ...p }, ref) => <textarea ref={ref} className={`nf-textarea ${className}`} {...p} />);
Textarea.displayName = "Textarea";

/* ---------------- Modal + Confirm ---------------------------------- */
export function Modal({ open, onClose, title, children, size = "md" }:
  { open: boolean; onClose: () => void; title: string; children: React.ReactNode; size?: "sm"|"md"|"lg" }) {
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={reduce ? { duration: 0 } : undefined}>
          <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
          <motion.div role="dialog" aria-modal="true" aria-label={title}
            className={`nf-panel relative z-10 w-full p-5 shadow-lg ${size==="sm"?"max-w-sm":size==="lg"?"max-w-3xl":"max-w-lg"}`}
            initial={reduce ? false : { y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
            exit={reduce ? undefined : { y: 8, opacity: 0 }}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">{title}</h2>
              <button className="nf-btn nf-btn-ghost !px-2" onClick={onClose} aria-label="Close"><X size={16}/></button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Confirm({ open, title, body, danger, onConfirm, onCancel }:
  { open: boolean; title: string; body: string; danger?: boolean;
    onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal open={open} onClose={onCancel} title={title} size="sm">
      <p className="mb-4 text-sm text-muted">{body}</p>
      <div className="flex justify-end gap-2">
        <Button kind="ghost" onClick={onCancel}>Cancel</Button>
        <Button kind={danger ? "danger" : "primary"} onClick={onConfirm}>Confirm</Button>
      </div>
    </Modal>
  );
}

/* ---------------- Toast host --------------------------------------- */
export function ToastHost({ toasts, onDismiss }:
  { toasts: { id: string; kind: "info"|"success"|"error"; message: string }[]; onDismiss: (id: string) => void }) {
  const reduce = useReducedMotion();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} initial={reduce ? false : { y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }} exit={reduce ? undefined : { opacity: 0 }}
            className="pointer-events-auto nf-panel px-4 py-3 text-sm shadow-md"
            style={{ borderLeft: `3px solid ${t.kind==="error"?"var(--nf-danger)":t.kind==="success"?"var(--nf-success)":"var(--nf-accent)"}` }}>
            <div className="flex items-center gap-3">
              <span className="flex-1">{t.message}</span>
              <button className="nf-btn nf-btn-ghost !px-1" onClick={() => onDismiss(t.id)} aria-label="Dismiss"><X size={14}/></button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ---------------- Skeleton / Empty / Error ------------------------- */
export function Skeleton({ h = 16, w = "100%", className = "" }: { h?: number; w?: number|string; className?: string }) {
  return <div className={`nf-skeleton ${className}`} style={{ height: h, width: w }} />;
}
export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[color:var(--nf-border)] p-10 text-center">
      <div className="text-sm font-medium">{title}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
      {action}
    </div>
  );
}

/* ---------------- Color + Priority + Tag pickers ------------------- */
export function ColorSwatches({ value, onChange }: { value: NoteColor; onChange: (c: NoteColor) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {NOTE_COLORS.map((c) => (
        <button key={c} type="button" aria-label={`color ${c}`} onClick={() => onChange(c)}
          className="h-6 w-6 rounded-full transition-transform hover:scale-110 nf-focusable"
          style={{
            background: NOTE_COLOR_TOKENS[c].surface,
            outline: value === c ? `2px solid ${NOTE_COLOR_TOKENS[c].accent}` : "none",
            outlineOffset: 2,
          }} />
      ))}
    </div>
  );
}

export function PriorityPicker({ value, onChange }: { value: Priority; onChange: (p: Priority) => void }) {
  return (
    <select className="nf-select" value={value} onChange={(e) => onChange(e.target.value as Priority)}>
      {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
    </select>
  );
}

export function DateTimeLocal({ value, onChange, clearLabel }:
  { value: string | null; onChange: (iso: string | null) => void; clearLabel?: string }) {
  const toLocal = (iso: string | null) => iso ? new Date(iso).toISOString().slice(0, 16) : "";
  return (
    <div className="flex items-center gap-2">
      <input type="datetime-local" className="nf-input" value={toLocal(value)}
        onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)} />
      {value && (
        <Button kind="ghost" onClick={() => onChange(null)} aria-label={clearLabel ?? "Clear"}>
          <X size={14}/>
        </Button>
      )}
    </div>
  );
}

/* ---------------- Checklist ---------------------------------------- */
export function Checklist({ items, onAdd, onToggle, onRemove, readOnly }:
  { items: NoteChecklistItem[];
    onAdd?: (text: string) => void; onToggle?: (id: string, done: boolean) => void;
    onRemove?: (id: string) => void; readOnly?: boolean }) {
  const [draft, setDraft] = useState("");
  return (
    <div className="space-y-1.5">
      {items.map((c) => (
        <label key={c.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={c.is_completed} disabled={readOnly}
            onChange={(e) => onToggle?.(c.id, e.target.checked)}
            className="h-4 w-4 rounded accent-[var(--nf-accent)]" />
          <span className={c.is_completed ? "line-through text-subtle" : ""}>{c.text}</span>
          {!readOnly && onRemove && (
            <button className="ml-auto text-subtle hover:text-danger nf-focusable" onClick={() => onRemove(c.id)} aria-label="Remove item">
              <Trash2 size={14}/>
            </button>
          )}
        </label>
      ))}
      {!readOnly && onAdd && (
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); const v = draft.trim(); if (!v) return; onAdd(v); setDraft(""); }}>
          <input className="nf-input" placeholder="Add checklist item" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <Button kind="ghost" type="submit" aria-label="Add"><Plus size={16}/></Button>
        </form>
      )}
      {items.length === 0 && readOnly && (
        <div className="text-xs text-subtle">No checklist items.</div>
      )}
    </div>
  );
}

/* ---------------- Note card ---------------------------------------- */
export function NoteCard({ note, tags = [], checklist, onOpen, onPin, onArchive, onDelete, draggable, onDragStart, onDragEnd }:
  { note: Note; tags?: string[]; checklist?: NoteChecklistItem[];
    onOpen: () => void; onPin: () => void; onArchive: () => void; onDelete: () => void;
    draggable?: boolean; onDragStart?: () => void; onDragEnd?: () => void }) {
  const done = (checklist ?? []).filter((c) => c.is_completed).length;
  const total = checklist?.length ?? 0;
  const overdue = note.due_at && Date.parse(note.due_at) < Date.now();
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDoubleClick={onOpen}
      className="nf-card group relative flex cursor-pointer flex-col gap-2 rounded-lg p-4 shadow-sm hover:shadow-md"
      data-color={note.color}
      role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 font-semibold leading-tight">{note.title || "Untitled"}</h3>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button className="nf-btn nf-btn-ghost !px-1.5" onClick={(e) => { e.stopPropagation(); onPin(); }}
            aria-label={note.is_pinned ? "Unpin" : "Pin"}>
            {note.is_pinned ? <PinOff size={14}/> : <Pin size={14}/>}
          </button>
          <button className="nf-btn nf-btn-ghost !px-1.5" onClick={(e) => { e.stopPropagation(); onArchive(); }}
            aria-label={note.is_archived ? "Restore" : "Archive"}><Archive size={14}/></button>
          <button className="nf-btn nf-btn-ghost !px-1.5" onClick={(e) => { e.stopPropagation(); onDelete(); }}
            aria-label="Delete"><Trash2 size={14}/></button>
        </div>
      </div>
      {note.content && <p className="line-clamp-4 whitespace-pre-wrap text-sm text-muted">{note.content}</p>}
      {total > 0 && (
        <div className="mt-1 text-xs">
          <span className="inline-flex items-center gap-1"><Check size={12}/> {done}/{total} done</span>
        </div>
      )}
      {(tags.length > 0 || note.priority !== "normal" || note.due_at) && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {note.is_pinned && <span className="nf-chip"><Pin size={10}/> pinned</span>}
          {note.priority !== "normal" && <span className="nf-chip" style={{ color: `var(--card-accent)` }}>{note.priority}</span>}
          {note.due_at && (
            <span className={`nf-chip ${overdue ? "!text-[color:var(--nf-danger)]" : ""}`}>
              <Calendar size={10}/> {new Date(note.due_at).toLocaleDateString()}
            </span>
          )}
          {tags.map((t) => <span key={t} className="nf-chip"><TagIcon size={10}/> {t}</span>)}
        </div>
      )}
    </div>
  );
}

/* ---------------- Sync indicator ----------------------------------- */
export function SyncBadge({ status, onRetry }: { status: SyncStatus; onRetry?: () => void }) {
  const map: Record<SyncStatus, { icon: React.ReactNode; label: string; cls: string }> = {
    online:  { icon: <Wifi size={14}/>, label: "Online", cls: "text-success" },
    syncing: { icon: <RefreshCw size={14} className="animate-spin"/>, label: "Syncing", cls: "text-info" },
    offline: { icon: <WifiOff size={14}/>, label: "Offline", cls: "text-muted" },
    error:   { icon: <WifiOff size={14}/>, label: "Sync error", cls: "text-danger" },
  };
  const m = map[status];
  return (
    <button onClick={onRetry} className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs nf-focusable ${m.cls}`}
      style={{ background: "var(--nf-surface-3)" }}>
      {m.icon}<span>{m.label}</span>
    </button>
  );
}

/* ---------------- Icons + small helpers ---------------------------- */
export const Spinner = () => <Loader2 size={14} className="animate-spin" />;

export function ThemeToggle() {
  const { theme, set } = useUI();
  return (
    <button className="nf-btn nf-btn-ghost !px-2" aria-label="Toggle theme"
      onClick={() => set({ theme: theme === "dark" ? "light" : "dark" })}>
      {theme === "dark" ? <Sun size={16}/> : <Moon size={16}/>}
    </button>
  );
}

export function ViewToggle() {
  const { view, set } = useUI();
  return (
    <div className="flex overflow-hidden rounded-md border border-[color:var(--nf-border)]">
      <button className={`nf-btn nf-btn-ghost !px-2 ${view==="grid"?"!text-[color:var(--nf-accent-strong)]":""}`}
        onClick={() => set({ view: "grid" })} aria-label="Grid view"><LayoutGrid size={14}/></button>
      <button className={`nf-btn nf-btn-ghost !px-2 ${view==="list"?"!text-[color:var(--nf-accent-strong)]":""}`}
        onClick={() => set({ view: "list" })} aria-label="List view"><List size={14}/></button>
    </div>
  );
}

/* ---------------- Search box (debounced externally) ---------------- */
export const SearchInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className = "", ...p }, ref) => (
    <div className={`relative flex-1 min-w-[200px] ${className}`}>
      <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
      <input ref={ref} className="nf-input !pl-9" placeholder="Search notes  (Ctrl/Cmd+K)" {...p} />
    </div>
  ));
SearchInput.displayName = "SearchInput";

/* ---------------- Reminders list ---------------------------------- */
export function RemindersList({ notes, onSnooze, onComplete }:
  { notes: Note[]; onSnooze: (id: string) => void; onComplete: (id: string) => void }) {
  const sorted = [...notes].filter((n) => n.reminder_at).sort((a, b) =>
    Date.parse(a.reminder_at!) - Date.parse(b.reminder_at!));
  if (sorted.length === 0) return <EmptyState title="No upcoming reminders" hint="Add a reminder time to any note." />;
  return (
    <div className="space-y-2">
      {sorted.slice(0, 5).map((n) => {
        const overdue = Date.parse(n.reminder_at!) < Date.now();
        return (
          <div key={n.id} className="nf-panel flex items-center justify-between p-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{n.title || "Untitled"}</div>
              <div className={`text-xs ${overdue ? "text-danger" : "text-muted"}`}>
                <Bell size={11} className="mr-1 inline"/> {new Date(n.reminder_at!).toLocaleString()}
              </div>
            </div>
            <div className="flex gap-1">
              <Button kind="ghost" onClick={() => onSnooze(n.id)}>Snooze</Button>
              <Button kind="ghost" onClick={() => onComplete(n.id)}><Check size={14}/></Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Widget row (used in WidgetManager + desktop list) - */
export function WidgetRow({ pref, note, onEdit, onToggleVisible, onDelete, onMoveUp, onMoveDown }:
  { pref: WidgetPreference; note?: Note;
    onEdit: () => void; onToggleVisible: () => void; onDelete: () => void;
    onMoveUp: () => void; onMoveDown: () => void }) {
  return (
    <div className="nf-panel flex items-center justify-between p-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{note?.title || "Untitled note"}</div>
        <div className="text-xs text-muted">
          {pref.width}×{pref.height} · opacity {Math.round(pref.opacity * 100)}% ·
          {" "}{pref.is_always_on_top ? "always-on-top" : "normal"} ·
          {" "}{pref.is_visible ? "visible" : "hidden"}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button kind="ghost" onClick={onMoveUp} aria-label="Move up"><ChevronLeft size={14} className="-rotate-90"/></Button>
        <Button kind="ghost" onClick={onMoveDown} aria-label="Move down"><ChevronRight size={14} className="-rotate-90"/></Button>
        <Button kind="ghost" onClick={onEdit}>Edit</Button>
        <Button kind="ghost" onClick={onToggleVisible}>{pref.is_visible ? "Hide" : "Show"}</Button>
        <Button kind="ghost" onClick={onDelete} aria-label="Close widget (does not delete note)"><X size={14}/></Button>
      </div>
    </div>
  );
}

/* ---------------- Focus-preserving autosave hook ------------------- */
export function useDebouncedEffect<T extends unknown[]>(fn: (...a: T) => void, deps: T, delay = 800) {
  const ref = useRef<number | null>(null);
  useEffect(() => {
    if (ref.current) window.clearTimeout(ref.current);
    ref.current = window.setTimeout(() => fn(...deps), delay);
    return () => { if (ref.current) window.clearTimeout(ref.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, delay]);
}

/* ---------------- Icons export for pages --------------------------- */
export const Icons = {
  Plus, Search, Settings, Pin, PinOff, Archive, Trash2, X, Check,
  ChevronLeft, ChevronRight, Bell, Calendar, TagIcon, RefreshCw,
};
