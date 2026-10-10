-- =============================================================
-- NoteFlow :: seed.sql  (development / onboarding only)
-- Run locally via `supabase db reset` or manually in the SQL editor.
-- Requires at least one auth user; picks the newest by created_at.
-- To remove: run the DELETE statements at the bottom.
-- =============================================================

do $$
declare
  u uuid;
  cat_todo uuid;
  cat_work uuid;
  cat_personal uuid;
  n1 uuid; n2 uuid;
begin
  select id into u from auth.users order by created_at desc limit 1;
  if u is null then
    raise notice 'seed skipped: no auth user exists yet. Sign up first, then re-run.';
    return;
  end if;

  -- default categories for this user
  insert into public.categories (user_id, name, color, sort_order) values
    (u, 'Personal',   'sky',     1),
    (u, 'Work',       'indigo',  2),
    (u, 'Documents',  'slate',   3),
    (u, 'Bills',      'amber',   4),
    (u, 'Shopping',   'rose',    5),
    (u, 'To-do',      'emerald', 6),
    (u, 'Uncategorized','violet', 7)
  on conflict (user_id, name) do nothing;

  select id into cat_todo    from public.categories where user_id = u and name = 'To-do';
  select id into cat_work    from public.categories where user_id = u and name = 'Work';
  select id into cat_personal from public.categories where user_id = u and name = 'Personal';

  -- sample note 1 (welcome)
  insert into public.notes (user_id, category_id, title, content, color, priority, is_pinned, sort_order)
  values (u, cat_personal, 'Welcome to NoteFlow',
    'This is your first note. It syncs in real time between web, mobile PWA, and the Windows desktop widget.',
    'indigo', 'normal', true, 0)
  returning id into n1;

  insert into public.note_checklist_items (note_id, user_id, text, is_completed, sort_order) values
    (n1, u, 'Sign in from your phone', false, 0),
    (n1, u, 'Open the desktop widget app', false, 1),
    (n1, u, 'Edit this note and watch it update everywhere', false, 2);

  -- sample note 2 (task)
  insert into public.notes (user_id, category_id, title, content, color, priority, due_at, reminder_at, sort_order)
  values (u, cat_work, 'Review Q4 report', 'Draft due Friday afternoon.',
          'amber', 'high',
          now() + interval '2 days',
          now() + interval '1 day',
          1)
  returning id into n2;

  -- a tag + assignment
  insert into public.note_tags (user_id, name, color) values (u, 'focus', 'violet')
  on conflict (user_id, name) do nothing;

  insert into public.note_tag_assignments (note_id, tag_id, user_id)
  select n2, t.id, u from public.note_tags t
   where t.user_id = u and t.name = 'focus'
  on conflict (note_id, tag_id) do nothing;

  -- default widget preference for the welcome note
  insert into public.widget_preferences (user_id, note_id, widget_order, width, height, opacity, preferred_position)
  values (u, n1, 0, 320, 260, 0.92, jsonb_build_object('x', 120, 'y', 120, 'monitor', null))
  on conflict (user_id, note_id) do nothing;

  raise notice 'seed complete for user %', u;
end $$;

-- Rollback helper (paste manually if you need to remove the seed):
-- delete from public.note_tag_assignments where user_id in (select id from auth.users);
-- delete from public.note_checklist_items where user_id  in (select id from auth.users);
-- delete from public.widget_preferences   where user_id  in (select id from auth.users);
-- delete from public.notes                where user_id  in (select id from auth.users);
-- delete from public.note_tags            where user_id  in (select id from auth.users);
-- delete from public.categories           where user_id  in (select id from auth.users);
