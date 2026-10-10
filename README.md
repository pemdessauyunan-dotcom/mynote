# NoteFlow

Real-time personal notes with native Windows desktop widgets. One account syncs your notes across the **web app**, the **mobile PWA**, and the **Tauri 2 desktop widget app** via Supabase Realtime.

- Web: React + TypeScript + Vite + Tailwind + Framer Motion + Zustand.
- Backend: Supabase (Postgres, Auth, Realtime, Row Level Security).
- Desktop: Tauri 2 (real OS windows — not CSS overlays — with always-on-top, drag, transparent backdrop, tray, per-widget geometry persisted locally).
- Mobile: responsive web + PWA installable via manifest + service worker.

---

## Repository layout

```
noteflow/
  apps/
    web/            React/Vite dashboard + editor + settings + widget manager
    desktop/        Tauri 2 widget app (React front-end + Rust back-end)
  packages/
    shared/         Domain types, zod schemas, palette, concurrency helpers
    ui/             Design tokens (dark+light) shared by web + desktop
  supabase/
    migrations/     0001_init.sql, 0002_rls.sql, 0003_realtime.sql
    seed.sql        Optional dev/onboarding seed (deletable)
  tests/            Notes about e2e tests (Playwright spec lives in apps/web/e2e)
```

pnpm workspace is defined in `pnpm-workspace.yaml`. Node 20.11+ and pnpm 10 are required.

---

## Quickstart

```bash
# 1. install
pnpm install

# 2. copy env template and fill in Supabase project URL + anon key
cp .env.example .env
cp .env apps/web/.env.local
cp .env apps/desktop/.env.local
# edit the two VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY values

# 3. database
# Option A - local dev with the Supabase CLI:
supabase init            # one-time
supabase start
supabase db push         # applies supabase/migrations/*.sql
supabase db reset        # re-applies + runs supabase/seed.sql

# Option B - hosted Supabase project:
#   paste supabase/migrations/0001_init.sql, 0002_rls.sql, 0003_realtime.sql
#   into the SQL editor, in that order. Run seed.sql only if you want demo data.

# 4. web app (Vite dev server + PWA)
pnpm dev:web             # http://localhost:5173

# 5. desktop widgets (requires Rust toolchain installed)
#    Get rustup:  https://rustup.rs
pnpm dev:desktop
```

## Production builds

```bash
pnpm build:web           # apps/web/dist
pnpm build:desktop       # apps/desktop/src-tauri/target/release/bundle/...
```

Tauri needs the WebView2 runtime on Windows (bundled via `downloadBootstrapper` in `tauri.conf.json`).

---

## Environment variables

Only two are actually read by the frontends; the anon key is safe for browsers/desktop because **RLS enforces ownership** server-side:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-public-key>
VITE_APP_BASE_URL=http://localhost:5173     # used by desktop "Edit in web" link
```

Never ship `SUPABASE_SERVICE_ROLE_KEY` to web, PWA, or the desktop binary.

---

## How the pieces fit

### Database (see `supabase/migrations/0001_init.sql`)

Tables: `profiles`, `categories`, `notes`, `note_checklist_items`, `note_tags`, `note_tag_assignments`, `widget_preferences`, `device_preferences`. Foreign keys + `on delete cascade`/`set null` are set. Indexes cover user+active, user+pinned (partial), user+updated_at desc, reminder_at / due_at (partial where non-null). `notes.version` is bumped by a `before update` trigger, giving us optimistic concurrency. `notes.deleted_at` implements soft delete.

### RLS (`0002_rls.sql`)

Every policy is owner-scoped via `auth.uid() = user_id`. Checklist items and tag assignments additionally require the parent `note`/`tag` row to be owned by the caller, so cross-user joins cannot leak data.

### Realtime (`0003_realtime.sql`)

Tables are added to the `supabase_realtime` publication with `replica identity full` so DELETE events carry the old row. Clients subscribe with a `user_id=eq.<uid>` filter.

### Auth

Supabase Auth email + password. A trigger auto-creates a `profiles` row for each new user. Route protection in `apps/web/src/App.tsx` (`RequireAuth`). Password reset uses `supabase.auth.resetPasswordForEmail` and returns the user to `/reset-password`.

### Realtime sync + offline

- `apps/web/src/lib/index.ts` exports a `RealtimeManager` that:
  - subscribes per authenticated user, one channel per session,
  - skips echoes of local writes for 3 s per entity id,
  - reconnects with exponential backoff via `backoffDelay()`,
  - on reconnect triggers a full `fetchAll()` reconciliation (realtime is treated as a hint, not the source of truth),
  - forwards status changes (`online` / `syncing` / `offline` / `error`) to the UI badge.
- Autosave: `useDebouncedEffect` in `apps/web/src/components/index.tsx`, 800 ms debounce, per-note, with an in-flight guard. Local state stays dirty until the server confirms; on network failure the op is enqueued (`enqueue()` in `apps/web/src/lib/index.ts`) and drained on `online` events.
- Conflicts: writes carry `expectedVersion`. On mismatch, `reconcileNote()` (in `@noteflow/shared`) implements the field-level merge policy (server-newer wins for reads, local-newer wins body but adopts server's version so retries don't loop).

### Cache

Last-fetched snapshot per user in `localStorage` under `nf.cache.<uid>`. Never cleared before a successful sync. Cleared on sign-out via Settings.

### Desktop widgets

`apps/desktop/src-tauri/src/lib.rs`:
- One Tauri `WebviewWindow` per widget, frameless, transparent, resizable, `always_on_top`, `skip_taskbar`.
- Real drag: `data-tauri-drag-region` on the widget header (Tauri core handles the mouse-move → SetWindowPos call).
- Tray menu: Show all / Hide all / Open dashboard / Quit.
- Per-widget geometry (position, size, opacity, always-on-top, expanded, show_on_startup) is stored in the `widget_preferences` row in Postgres **and** mirrored into `noteflow.json` via `tauri-plugin-store`, so relaunch restores state even while offline.
- Native effects: `Effect::Acrylic` is applied on Windows 10/11 where supported; the widget's CSS opacity is separately driven by `documentElement.style.opacity` because per-pixel alpha on Windows is not portable.
- Close (✕) hides or closes the widget window without deleting the note. "Hide" moves it to the tray.

### PWA

`vite-plugin-pwa` generates a service worker that precaches the app shell. The manifest exposes `NoteFlow` as an installable app with the SVG icon. Data is **not** precached; the app renders the last-fetched snapshot from `localStorage` when offline.

### Reminders

Timestamps are stored as `timestamptz` in UTC. UI renders them in the device's local timezone. Desktop notifications use the `tauri-plugin-notification` API. PWA/mobile pushes require notification permission + a service worker push handler — this build does **not** ship push for mobile; see Known Limitations.

---

## Testing

```bash
pnpm test:unit           # Vitest in apps/web/src/**/*.test.ts
pnpm test:e2e            # Playwright (skeleton - see apps/web/e2e)
```

Unit tests cover the pure concurrency and backoff helpers, which are the riskiest logic (they run without network or Windows). `pnpm typecheck` runs the TypeScript compiler across every workspace.

---

## Definition of Done — honest state

Implemented and wired end-to-end in this repository:

1. Monorepo layout (pnpm workspaces, shared package, UI tokens, apps/web, apps/desktop).
2. Supabase schema, indexes, FKs, triggers, `version` bump, `handle_new_user` trigger, `touch_updated_at`.
3. RLS on every owned table (defense-in-depth for checklist and tag assignments).
4. Realtime publication + clients that subscribe with `user_id=eq.<uid>` filter and resubscribe on reconnect.
5. Supabase Auth: sign up / login / logout / password reset / session persistence / route protection / expiry handling.
6. Note CRUD with autosave, checklist, tags, color, category, priority, due date, reminder, archive, soft delete, restore, search, filters, grid/list, drag-to-reorder, quick-add, keyboard shortcuts (Ctrl/Cmd+K search, Ctrl/Cmd+N new).
7. Optimistic concurrency + `reconcileNote()` conflict policy, exponential backoff retry, offline queue with idempotency keys, `SyncBadge` with online/syncing/offline/error.
8. Local cache written per user; rendered when fetchAll fails.
9. Design system with dark-default charcoal surfaces, indigo accent, pastel cards per note color, light mode, reduced motion, focus rings, skeletons, empty and error states, toasts, confirm modal.
10. Widget manager page in the web app: choose note, size, opacity, position, always-on-top, expanded/compact, show on startup.
11. Tauri 2 desktop app: real native windows, `always_on_top`, drag via `data-tauri-drag-region`, per-widget geometry persisted to `tauri-plugin-store` and to `widget_preferences`, restore on launch, tray with Show/Hide/Quit, Acrylic effect where supported, subscribe to Supabase Realtime, render cached snapshot when offline.
12. PWA manifest + service worker for the app shell.
13. Import (validated) and Export (JSON) of notes.

Not verified (require hardware / live credentials that this sandbox does not have):

- Actual Supabase round-trips. Migrations and RLS policies are written but not executed against a live project here.
- Tauri build on Windows (`cargo` is not installed in this sandbox). Rust code is written to compile but not compiled here.
- Multi-device realtime scenarios end-to-end (needs two browsers + one Windows machine).
- Acrylic / per-pixel transparency on all Windows versions; visual fallback is CSS opacity.

Deliberately incomplete / not promised (documented rather than faked):

- **Click-through mode** — the `set_click_through` command returns an explicit error in this build. The brief says *jangan berpura-pura*; a safe implementation requires flipping `WS_EX_TRANSPARENT` and a global hotkey, which needs to be tested on real Windows.
- **Mobile PWA push notifications** — requires a notification backend (VAPID keys + a service worker push handler) and browser/OS-specific support. The UI surfaces reminders on-device only while the PWA is open; a background push implementation is out of scope for this pass.
- **Startup task** — `tauri-plugin-autostart` is wired but disabled by default; enabling it is an explicit user toggle in Settings (not yet exposed as a control).

## Working with this repo

- `pnpm install` first; every red squiggle about `Cannot find module 'react'` etc. resolves after install.
- The web app expects `.env.local` files to exist under `apps/web/` and `apps/desktop/`.
- After editing migrations, run `supabase db reset` locally or re-apply the changed migration in the hosted project.
- To add a new note field: update `packages/shared/src/index.ts` (type + zod schema), the migration, `apps/web/src/lib/index.ts` (payload shape), and any component. The CHECK constraints in Postgres are the final authority.

## License

Private / not specified.
