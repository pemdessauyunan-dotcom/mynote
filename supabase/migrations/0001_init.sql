-- =============================================================
-- NoteFlow :: 0001_init.sql
-- Schema, extensions, tables, FKs, indexes, CHECK constraints,
-- helper functions, and updated_at/version triggers.
-- Run order matters: 0001 -> 0002 (RLS) -> 0003 (realtime).
-- =============================================================

create extension if not exists "pgcrypto";    -- gen_random_uuid()
-- citext for case-insensitive tag/category names
create extension if not exists "citext";

-- -------------------------------------------------------------
-- profiles: 1:1 mirror of auth.users, created by trigger below.
-- -------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'New user'
               check (char_length(display_name) between 1 and 60),
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- -------------------------------------------------------------
-- categories
-- -------------------------------------------------------------
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
create index if not exists categories_user_sort_idx
  on public.categories (user_id, sort_order);

-- -------------------------------------------------------------
-- notes (soft-deleted via deleted_at; optimistic concurrency via version)
-- -------------------------------------------------------------
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
create index if not exists notes_user_active_idx
  on public.notes (user_id, is_archived, deleted_at, sort_order);
create index if not exists notes_user_pinned_idx
  on public.notes (user_id, is_pinned) where is_pinned = true and deleted_at is null;
create index if not exists notes_user_updated_idx
  on public.notes (user_id, updated_at desc);
create index if not exists notes_user_reminder_idx
  on public.notes (user_id, reminder_at) where reminder_at is not null and deleted_at is null;
create index if not exists notes_user_due_idx
  on public.notes (user_id, due_at) where due_at is not null and deleted_at is null;
create index if not exists notes_category_idx
  on public.notes (category_id);

-- -------------------------------------------------------------
-- note_checklist_items
-- -------------------------------------------------------------
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
create index if not exists checklist_note_idx
  on public.note_checklist_items (note_id, sort_order);
-- user_id must equal the parent note's user_id (enforced by trigger below)
-- and RLS policies (see 0002_rls.sql).

-- -------------------------------------------------------------
-- note_tags + note_tag_assignments (m2m with owner column for RLS)
-- -------------------------------------------------------------
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

-- -------------------------------------------------------------
-- widget_preferences (one widget per (user, note))
-- -------------------------------------------------------------
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
create index if not exists widget_pref_user_order_idx
  on public.widget_preferences (user_id, widget_order);

-- -------------------------------------------------------------
-- device_preferences
-- -------------------------------------------------------------
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

-- Keep updated_at fresh on every UPDATE.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Bump note.version on every UPDATE so optimistic concurrency works.
create or replace function public.bump_note_version()
returns trigger language plpgsql as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $$;

-- Auto-create a profile row when a new auth user signs up.
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

-- Guard: a checklist item's user_id must match its note's user_id.
-- Prevents cross-user writes even if RLS is misconfigured.
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

-- Guard: a tag assignment's user_id must match both note and tag owners.
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

-- New auth user -> profile row.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
