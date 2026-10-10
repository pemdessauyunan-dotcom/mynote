-- =============================================================
-- NoteFlow :: 0002_rls.sql
-- Row Level Security. Every policy is owner-scoped.
-- Related tables (checklist, tag_assignments) also require the
-- parent row to be owned by the caller, so joins cannot be used
-- to read someone else's data.
-- =============================================================

alter table public.profiles              enable row level security;
alter table public.categories            enable row level security;
alter table public.notes                 enable row level security;
alter table public.note_checklist_items  enable row level security;
alter table public.note_tags             enable row level security;
alter table public.note_tag_assignments  enable row level security;
alter table public.widget_preferences    enable row level security;
alter table public.device_preferences    enable row level security;

-- Convenience: auth.uid() = user_id
create or replace function public.owns(userId uuid)
returns boolean language sql stable as $$
  select coalesce(auth.uid() = userId, false)
$$;

-- profiles -----------------------------------------------------
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
-- INSERT is handled by security-definer trigger on auth.users.

-- categories ---------------------------------------------------
drop policy if exists categories_own on public.categories;
create policy categories_own on public.categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- notes --------------------------------------------------------
drop policy if exists notes_own on public.notes;
create policy notes_own on public.notes
  for select using (auth.uid() = user_id);

drop policy if exists notes_insert_own on public.notes;
create policy notes_insert_own on public.notes
  for insert with check (auth.uid() = user_id);

drop policy if exists notes_update_own on public.notes;
create policy notes_update_own on public.notes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists notes_delete_own on public.notes;
create policy notes_delete_own on public.notes
  for delete using (auth.uid() = user_id);

-- note_checklist_items ----------------------------------------
-- Also require parent note to be owned (defense in depth vs. join tricks).
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

-- note_tags ----------------------------------------------------
drop policy if exists tags_own on public.note_tags;
create policy tags_own on public.note_tags
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- note_tag_assignments ----------------------------------------
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

-- widget_preferences ------------------------------------------
drop policy if exists widget_own on public.widget_preferences;
create policy widget_own on public.widget_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- device_preferences ------------------------------------------
drop policy if exists device_own on public.device_preferences;
create policy device_own on public.device_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- No policy = denied. Service-role key bypasses RLS but MUST NOT
-- be shipped to browser, PWA, or desktop binary.
