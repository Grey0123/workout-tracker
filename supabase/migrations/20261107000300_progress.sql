-- Progress and evaluations (M5, PRD 5.4).

-- A goal can name an exercise and a target estimated 1RM, so Progress can show how
-- far along it is ("bench e1RM 72 → 80 kg"). Both stay optional: "log every meal
-- this week" is a goal too.
alter table public.coach_notes
  add column goal_exercise_id uuid references public.exercises (id) on delete set null,
  add column goal_target_kg numeric(6, 2) check (goal_target_kg > 0),
  add constraint coach_notes_goal_fields check (kind = 'goal' or (goal_exercise_id is null and goal_target_kg is null)),
  add constraint coach_notes_goal_pair check ((goal_exercise_id is null) = (goal_target_kg is null));

-- A video's file lives in its owner's folder, so the storage rules and the row agree
-- on whose it is.
alter table public.workout_media
  add constraint workout_media_own_folder check (split_part(path, '/', 1) = user_id::text);
