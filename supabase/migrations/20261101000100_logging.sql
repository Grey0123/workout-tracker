-- What the log forms write through (M2). Both functions run as the caller, so the
-- access rules, stamps and edit history in the first migration apply as usual.

-- A set's number identifies it within an exercise, which is what lets an edit
-- change just the sets that differ instead of replacing them all.
drop index public.sets_session_exercise;
create unique index sets_session_exercise on public.sets (session_exercise_id, set_no);

-- Saves one exercise and its sets, all or nothing. p_id is chosen by the client, so
-- a retried save can't log the exercise twice. p_date only applies to a new entry.
create function public.save_session_exercise(
  p_id uuid, p_user_id uuid, p_date date, p_exercise_id uuid,
  p_variant text, p_notes text, p_tempo text, p_sets jsonb
) returns void
language plpgsql set search_path = '' as $$
declare
  v_session uuid;
  v_count   integer := jsonb_array_length(p_sets);
  v_found   integer;
begin
  if v_count = 0 then
    raise exception 'an exercise needs at least one set' using errcode = '22023';
  end if;

  -- A retry can arrive while the first try is still running. It waits, then updates.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));

  update public.session_exercises
  set exercise_id = p_exercise_id, variant = p_variant, notes = p_notes, tempo = p_tempo
  where id = p_id;
  get diagnostics v_found = row_count;

  if v_found = 0 then
    -- One session per day: two saves at once mustn't each start a new one.
    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || p_date::text, 0));

    select id into v_session from public.sessions
    where user_id = p_user_id and date = p_date and deleted_at is null
    order by created_at limit 1;

    if v_session is null then
      insert into public.sessions (user_id, date) values (p_user_id, p_date) returning id into v_session;
    end if;

    insert into public.session_exercises (id, session_id, exercise_id, position, variant, notes, tempo)
    select p_id, v_session, p_exercise_id, coalesce(max(position) + 1, 0), p_variant, p_notes, p_tempo
    from public.session_exercises where session_id = v_session;
  end if;

  insert into public.sets (session_exercise_id, set_no, weight_kg, reps, duration_s, distance_km,
                           rounds, rpe, calories, tempo, side)
  select p_id, n,
         (s ->> 'weight_kg')::numeric, (s ->> 'reps')::integer, (s ->> 'duration_s')::integer,
         (s ->> 'distance_km')::numeric, (s ->> 'rounds')::integer, (s ->> 'rpe')::numeric,
         (s ->> 'calories')::integer, s ->> 'tempo', (s ->> 'side')::public.set_side
  from jsonb_array_elements(p_sets) with ordinality as t (s, n)
  on conflict (session_exercise_id, set_no) do update set
    weight_kg = excluded.weight_kg, reps = excluded.reps, duration_s = excluded.duration_s,
    distance_km = excluded.distance_km, rounds = excluded.rounds, rpe = excluded.rpe,
    calories = excluded.calories, tempo = excluded.tempo, side = excluded.side;

  delete from public.sets where session_exercise_id = p_id and set_no > v_count;

  -- Row-level security skips rows silently. An Add & edit coach may not remove a
  -- set, so that has to fail rather than report a save that didn't fully happen.
  if exists (select 1 from public.sets where session_exercise_id = p_id and set_no > v_count) then
    raise exception 'not allowed to remove sets' using errcode = '42501';
  end if;
end $$;

-- One meal per slot per day: logging a slot again updates what's there.
create function public.save_meal(
  p_user_id uuid, p_date date, p_slot public.meal_slot,
  p_description text, p_notes text, p_photo_path text
) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_id uuid;
begin
  if coalesce(p_description, '') = '' and p_photo_path is null then
    raise exception 'a meal needs a description or a photo' using errcode = '22023';
  end if;

  insert into public.meals (user_id, date, slot, description, notes, photo_path)
  values (p_user_id, p_date, p_slot, p_description, p_notes, p_photo_path)
  on conflict (user_id, date, slot) where deleted_at is null do update set
    description = excluded.description, notes = excluded.notes, photo_path = excluded.photo_path
  returning id into v_id;
  return v_id;
end $$;

revoke all on function
  public.save_session_exercise(uuid, uuid, date, uuid, text, text, text, jsonb),
  public.save_meal(uuid, date, public.meal_slot, text, text, text)
  from public, anon, authenticated;
grant execute on function
  public.save_session_exercise(uuid, uuid, date, uuid, text, text, text, jsonb),
  public.save_meal(uuid, date, public.meal_slot, text, text, text)
  to authenticated;
