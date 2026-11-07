-- The coach workspace (M4, PRD 5.3): coaches log for clients, and clients can see
-- and undo exactly what changed. The rules for who may write what are unchanged
-- from the first migration. This adds what the screens need on top of them.

-- One save is one transaction, and it's what the history shows, notifies and undoes
-- as one change. Timestamps can't tell two quick saves apart, so record which it was.
alter table public.edit_history add column tx bigint not null default txid_current();
create index edit_history_tx on public.edit_history (owner_id, tx);

-- As before, plus the history row and transaction in each notification, so the
-- client can go from "Coach Andi changed Bench Press" straight to that change.
create or replace function public.audit_entry() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor   uuid := auth.uid();
  v_owner   uuid;
  v_id      uuid;
  v_before  jsonb;
  v_after   jsonb;
  v_history uuid;
begin
  if v_actor is null then
    return null;     -- trusted server work, e.g. the v1 import
  end if;

  if tg_op <> 'INSERT' then v_before := to_jsonb(old); v_id := old.id; end if;
  if tg_op <> 'DELETE' then v_after  := to_jsonb(new); v_id := new.id; end if;

  if tg_op = 'UPDATE'
     and (v_before - 'updated_at' - 'updated_by') = (v_after - 'updated_at' - 'updated_by') then
    return null;     -- nothing a person would call a change
  end if;

  if tg_table_name in ('sessions', 'meals') then
    v_owner := coalesce(v_after ->> 'user_id', v_before ->> 'user_id')::uuid;
  elsif tg_table_name = 'session_exercises' then
    select s.user_id into v_owner from public.sessions s
    where s.id = coalesce(v_after ->> 'session_id', v_before ->> 'session_id')::uuid;
  else
    select s.user_id into v_owner
    from public.session_exercises se
    join public.sessions s on s.id = se.session_id
    where se.id = coalesce(v_after ->> 'session_exercise_id', v_before ->> 'session_exercise_id')::uuid;
  end if;

  if v_owner is null then
    return null;     -- parent already gone: its own row recorded the delete
  end if;

  insert into public.edit_history (owner_id, table_name, row_id, op, changed_by, before, after)
  values (v_owner, tg_table_name, v_id, tg_op, v_actor, v_before, v_after)
  returning id into v_history;

  if v_actor <> v_owner then
    insert into public.notifications (user_id, type, actor_id, payload)
    values (v_owner, 'coach_change', v_actor, jsonb_build_object(
      'table', tg_table_name, 'row_id', v_id, 'op', tg_op, 'before', v_before, 'after', v_after,
      'history_id', v_history, 'tx', txid_current()));
  end if;
  return null;
end $$;

-- The sets of a deleted exercise are recorded before they go. When someone else
-- deleted it, the client is told about them too, so the notice can list them.
create or replace function public.audit_sets_before_exercise_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then
    return old;
  end if;
  select s.user_id into v_owner from public.sessions s where s.id = old.session_id;
  if v_owner is null then
    return old;
  end if;
  with recorded as (
    insert into public.edit_history (owner_id, table_name, row_id, op, changed_by, before)
    select v_owner, 'sets', x.id, 'DELETE', auth.uid(), to_jsonb(x)
    from public.sets x where x.session_exercise_id = old.id
    returning id, row_id, before
  )
  insert into public.notifications (user_id, type, actor_id, payload)
  select v_owner, 'coach_change', auth.uid(), jsonb_build_object(
    'table', 'sets', 'row_id', r.row_id, 'op', 'DELETE', 'before', r.before, 'after', null,
    'history_id', r.id, 'tx', txid_current())
  from recorded r
  where auth.uid() <> v_owner;
  return old;
end $$;

-- A coach logging a client's meal uploads its photo into the client's folder, so
-- the photo stays with the client's data. Only while the coach may edit meals.
create function public.storage_coach_writes(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_owner uuid;
begin
  begin
    v_owner := ((storage.foldername(p_name))[1])::uuid;
  exception when others then
    return false;
  end;
  return public.coach_writes(v_owner, 'meals');
end $$;

create policy media_insert_coach on storage.objects for insert to authenticated
  with check (bucket_id = 'meal-photos' and public.storage_coach_writes(name));

-- Everything that happened to one entry, newest first: an exercise with its sets,
-- or a meal. Runs as the caller, so the edit-history rules decide what's returned.
create function public.history_for(p_table text, p_id uuid) returns setof public.edit_history
language sql stable set search_path = '' as $$
  select * from public.edit_history
  where (table_name = p_table and row_id = p_id)
     or (p_table = 'session_exercises' and table_name = 'sets'
         and coalesce(after, before) ->> 'session_exercise_id' = p_id::text)
  order by changed_at desc, tx desc, id
$$;

-- Puts back what one or more changes did, as one step (PRD 4.2 and 5.3: the client
-- can restore what a coach deleted, and change back what a coach edited). Only the
-- owner of the data can, and only while nothing has changed since, so an undo can
-- never quietly overwrite a later edit.
create function public.undo_changes(p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  h public.edit_history;
begin
  if v_me is null or cardinality(p_ids) = 0
     or (select count(*) from public.edit_history where id = any (p_ids) and owner_id = v_me) <> cardinality(p_ids) then
    raise exception 'not found or not allowed' using errcode = '42501';
  end if;

  -- Something changed since: the same row, or for an added exercise, its sets.
  if exists (
    select 1 from public.edit_history undone, public.edit_history later
    where undone.id = any (p_ids) and not later.id = any (p_ids)
      and later.tx > undone.tx
      and (later.row_id = undone.row_id
           or (undone.table_name = 'session_exercises' and later.table_name = 'sets'
               and coalesce(later.after, later.before) ->> 'session_exercise_id' = undone.row_id::text))) then
    raise exception 'changed_since' using errcode = '40001';
  end if;

  -- Additions and edits first, sets before their exercise.
  for h in
    select * from public.edit_history where id = any (p_ids) and op <> 'DELETE'
    order by tx desc, case table_name when 'sets' then 0 when 'session_exercises' then 1 else 2 end
  loop
    if h.op = 'INSERT' then
      if h.table_name = 'sets' then
        delete from public.sets where id = h.row_id;
      elsif h.table_name = 'session_exercises' then
        delete from public.session_exercises where id = h.row_id;
      elsif h.table_name = 'meals' then
        update public.meals set deleted_at = now(), deleted_by = v_me where id = h.row_id and deleted_at is null;
      end if;
      -- A day that was started stays: it's empty without its exercises.
    elsif h.table_name = 'sets' then
      update public.sets t
      set (set_no, weight_kg, reps, duration_s, distance_km, rounds, rpe, calories, tempo, side) =
          (r.set_no, r.weight_kg, r.reps, r.duration_s, r.distance_km, r.rounds, r.rpe, r.calories, r.tempo, r.side)
      from jsonb_populate_record(null::public.sets, h.before) r
      where t.id = h.row_id;
    elsif h.table_name = 'session_exercises' then
      update public.session_exercises t
      set (exercise_id, position, variant, notes, tempo) = (r.exercise_id, r.position, r.variant, r.notes, r.tempo)
      from jsonb_populate_record(null::public.session_exercises, h.before) r
      where t.id = h.row_id;
    elsif h.table_name = 'meals' then
      update public.meals t
      set (description, notes, photo_path, deleted_at, deleted_by) = (r.description, r.notes, r.photo_path, r.deleted_at, r.deleted_by)
      from jsonb_populate_record(null::public.meals, h.before) r
      where t.id = h.row_id;
    elsif h.table_name = 'sessions' then
      update public.sessions t
      set (title, notes, deleted_at, deleted_by) = (r.title, r.notes, r.deleted_at, r.deleted_by)
      from jsonb_populate_record(null::public.sessions, h.before) r
      where t.id = h.row_id;
    end if;
  end loop;

  -- Then removals are put back, an exercise before its sets. An exercise always
  -- comes back with the sets deleted along with it, however the undo was asked for.
  for h in
    select * from public.edit_history where id = any (p_ids) and op = 'DELETE'
    order by case table_name when 'session_exercises' then 0 else 1 end, tx
  loop
    if h.table_name = 'session_exercises' then
      insert into public.session_exercises select (jsonb_populate_record(null::public.session_exercises, h.before)).*;
      insert into public.sets
      select (jsonb_populate_record(null::public.sets, gone.before)).*
      from public.edit_history gone
      where gone.owner_id = v_me and gone.tx = h.tx and gone.table_name = 'sets' and gone.op = 'DELETE'
        and gone.before ->> 'session_exercise_id' = h.row_id::text;
    elsif h.table_name = 'sets'
      and not exists (select 1 from public.sets where id = h.row_id) then
      insert into public.sets select (jsonb_populate_record(null::public.sets, h.before)).*;
    end if;
  end loop;
exception
  when unique_violation or foreign_key_violation then
    raise exception 'changed_since' using errcode = '40001';
end $$;

revoke all on function
  public.storage_coach_writes(text),
  public.history_for(text, uuid),
  public.undo_changes(uuid[])
  from public, anon, authenticated;
grant execute on function
  public.storage_coach_writes(text),
  public.history_for(text, uuid),
  public.undo_changes(uuid[])
  to authenticated;
