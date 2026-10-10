-- =============================================================
-- NoteFlow :: setup_all.sql
-- ONE-PASTE SETUP: schema + triggers + RLS + realtime.
-- Paste this whole file into Supabase SQL Editor and click Run.
-- (Equivalent to running 0001 -> 0002 -> 0003 in order.)
-- Safe to re-run: uses IF NOT EXISTS / DROP POLICY IF EXISTS.
-- =============================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ---------- profiles ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'New user'
               check (char_length(display_name) between 1 and 60),
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------- categories ----------
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       citext not null check (char_length(name) between 1 and 60),
  color      text not null default 'slate'
             check (color in ('slate','rose','amber','emerald','sky','violet','indigo')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);
create index if not exists categories_user_sort_idx on public.categories (user_id, sort_order);

-- ---------- notes ----------
create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  title       text not null default '' check (char_length(title) <= 200),
  content     text not null default '' check (char_length(content) <= 20000),
  color       text not null default 'slate'
              check (color in ('slate','rose','amber','emerald','sky','violet','indigo')),
  priority    text not null default 'normal'
              check (priority in ('low','normal','high','urgent')),
  is_pinned    boolean not null default false,
  is_archived  boolean not null default false,
  sort_order   integer not null default 0,
  due_at       timestamptz,
  reminder_at  timestamptz,
  version      integer not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists notes_user_active_idx on public.notes (user_id, is_archived, deleted_at, sort_order);
create index if not exists notes_user_pinned_idx on public.notes (user_id, is_pinned) where is_pinned = true and deleted_at is null;
create index if not exists notes_user_updated_idx on public.notes (user_id, updated_at desc);
create index if not exists notes_user_reminder_idx on public.notes (user_id, reminder_at) where reminder_at is not null and deleted_at is null;
create index if not exists notes_user_due_idx on public.notes (user_id, due_at) where due_at is not null and deleted_at is null;
create index if not exists notes_category_idx on public.notes (category_id);

-- ---------- note_checklist_items ----------
create table if not exists public.note_checklist_items (
  id            uuid primary key default gen_random_uuid(),
  note_id       uuid not null references public.notes(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  text          text not null check (char_length(text) between 1 and 500),
  is_completed  boolean not null default false,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists checklist_note_idx on public.note_checklist_items (note_id, sort_order);

-- ---------- note_tags + assignments ----------
create table if not exists public.note_tags (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       citext not null check (char_length(name) between 1 and 40),
  color      text check (color is null or color in
             ('slate','rose','amber','emerald','sky','violet','indigo')),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
create index if not exists note_tags_user_idx on public.note_tags (user_id);

create table if not exists public.note_tag_assignments (
  note_id  uuid not null references public.notes(id) on delete cascade,
  tag_id   uuid not null references public.note_tags(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (note_id, tag_id)
);
create index if not exists tag_assign_user_idx on public.note_tag_assignments (user_id);
create index if not exists tag_assign_tag_idx  on public.note_tag_assignments (tag_id);

-- ---------- widget_preferences ----------
create table if not exists public.widget_preferences (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  note_id           uuid not null references public.notes(id) on delete cascade,
  widget_order      integer not null default 0,
  width             integer not null default 320 check (width  between 200 and 1600),
  height            integer not null default 260 check (height between 120 and 1600),
  opacity           numeric(3,2) not null default 0.92 check (opacity between 0.40 and 1.00),
  preferred_position jsonb  not null default '{"x":100,"y":100,"monitor":null}'::jsonb,
  is_visible        boolean not null default true,
  is_always_on_top  boolean not null default true,
  expanded          boolean not null default true,
  show_on_startup   boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, note_id)
);
create index if not exists widget_pref_user_order_idx on public.widget_preferences (user_id, widget_order);

-- ---------- device_preferences ----------
create table if not exists public.device_preferences (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  device_id    text not null check (char_length(device_id) between 1 and 120),
  device_name  text not null check (char_length(device_name) between 1 and 60),
  device_type  text not null default 'unknown'
               check (device_type in ('web','desktop','mobile','unknown')),
  preferences  jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, device_id)
);
create index if not exists device_pref_user_idx on public.device_preferences (user_id);

-- =============================================================
-- Helper functions
-- =============================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.bump_note_version()
returns trigger language plpgsql as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  nm text;
begin
  nm := coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email, '@', 1));
  insert into public.profiles (id, display_name)
  values (new.id, left(nm, 60))
  on conflict (id) do nothing;
  return new;
end $$;

create or replace function public.guard_checklist_owner()
returns trigger language plpgsql as $$
declare
  owner uuid;
begin
  select user_id into owner from public.notes where id = new.note_id;
  if owner is null then
    raise exception 'note % does not exist', new.note_id;
  end if;
  if owner <> new.user_id then
    raise exception 'checklist user_id must match owning note';
  end if;
  return new;
end $$;

create or replace function public.guard_tag_assignment_owner()
returns trigger language plpgsql as $$
declare
  note_owner uuid; tag_owner uuid;
begin
  select user_id into note_owner from public.notes where id = new.note_id;
  select user_id into tag_owner  from public.note_tags where id = new.tag_id;
  if note_owner is distinct from new.user_id
     or tag_owner is distinct from new.user_id then
    raise exception 'tag assignment crosses users';
  end if;
  return new;
end $$;

-- =============================================================
-- Triggers
-- =============================================================
drop trigger if exists trg_touch_profiles on public.profiles;
create trigger trg_touch_profiles before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_touch_categories on public.categories;
create trigger trg_touch_categories before update on public.categories
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_notes_version on public.notes;
create trigger trg_notes_version before update on public.notes
  for each row execute function public.bump_note_version();

drop trigger if exists trg_touch_checklist on public.note_checklist_items;
create trigger trg_touch_checklist before update on public.note_checklist_items
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_checklist_owner on public.note_checklist_items;
create trigger trg_checklist_owner before insert or update on public.note_checklist_items
  for each row execute function public.guard_checklist_owner();

drop trigger if exists trg_tag_assign_owner on public.note_tag_assignments;
create trigger trg_tag_assign_owner before insert or update on public.note_tag_assignments
  for each row execute function public.guard_tag_assignment_owner();

drop trigger if exists trg_touch_widget on public.widget_preferences;
create trigger trg_touch_widget before update on public.widget_preferences
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_touch_device on public.device_preferences;
create trigger trg_touch_device before update on public.device_preferences
  for each row execute function public.touch_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================
-- Row Level Security (owner-scoped)
-- =============================================================
alter table public.profiles              enable row level security;
alter table public.categories            enable row level security;
alter table public.notes                 enable row level security;
alter table public.note_checklist_items  enable row level security;
alter table public.note_tags             enable row level security;
alter table public.note_tag_assignments  enable row level security;
alter table public.widget_preferences    enable row level security;
alter table public.device_preferences    enable row level security;

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists categories_own on public.categories;
create policy categories_own on public.categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists notes_own on public.notes;
create policy notes_own on public.notes for select using (auth.uid() = user_id);
drop policy if exists notes_insert_own on public.notes;
create policy notes_insert_own on public.notes for insert with check (auth.uid() = user_id);
drop policy if exists notes_update_own on public.notes;
create policy notes_update_own on public.notes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists notes_delete_own on public.notes;
create policy notes_delete_own on public.notes for delete using (auth.uid() = user_id);

drop policy if exists checklist_own on public.note_checklist_items;
create policy checklist_own on public.note_checklist_items
  for all
  using (
    auth.uid() = user_id
    and exists (select 1 from public.notes n where n.id = note_id and n.user_id = auth.uid())
  )
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.notes n where n.id = note_id and n.user_id = auth.uid())
  );

drop policy if exists tags_own on public.note_tags;
create policy tags_own on public.note_tags
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists tag_assign_own on public.note_tag_assignments;
create policy tag_assign_own on public.note_tag_assignments
  for all
  using (
    auth.uid() = user_id
    and exists (select 1 from public.notes n where n.id = note_id and n.user_id = auth.uid())
    and exists (select 1 from public.note_tags t where t.id = tag_id and t.user_id = auth.uid())
  )
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.notes n where n.id = note_id and n.user_id = auth.uid())
    and exists (select 1 from public.note_tags t where t.id = tag_id and t.user_id = auth.uid())
  );

drop policy if exists widget_own on public.widget_preferences;
create policy widget_own on public.widget_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists device_own on public.device_preferences;
create policy device_own on public.device_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =============================================================
-- Realtime publication
-- =============================================================
do $$
begin
  begin
    alter publication supabase_realtime add table public.notes;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table public.note_checklist_items;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table public.categories;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table public.note_tags;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table public.note_tag_assignments;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table public.widget_preferences;
  exception when duplicate_object then null; end;
end $$;

alter table public.notes                 replica identity full;
alter table public.note_checklist_items  replica identity full;
alter table public.widget_preferences    replica identity full;
