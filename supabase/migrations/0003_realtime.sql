-- =============================================================
-- NoteFlow :: 0003_realtime.sql
-- Supabase Realtime: replicate ONLY the columns we need for
-- live updates. Column-level filters (via publication) reduce
-- the chance of leaking sensitive data. RLS still gates who
-- receives which row (postgres_changes honors RLS per subscriber).
-- =============================================================

alter publication supabase_realtime add table public.notes;
alter publication supabase_realtime add table public.note_checklist_items;
alter publication supabase_realtime add table public.categories;
alter publication supabase_realtime add table public.note_tags;
alter publication supabase_realtime add table public.note_tag_assignments;
alter publication supabase_realtime add table public.widget_preferences;

-- Optional replica identity full so DELETE events include the old row.
alter table public.notes                 replica identity full;
alter table public.note_checklist_items  replica identity full;
alter table public.widget_preferences    replica identity full;
