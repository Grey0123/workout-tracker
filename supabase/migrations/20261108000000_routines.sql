-- Routines and plans (M7; PRD 5.3 "Assign plans" and "Prescribe tempo", 5.5 routine templates).
--
-- Differences from the PRD's sketch:
--   * Anyone can put a routine on a day, not only a coach: "Start Push Day" on your
--     own log is the same thing as a coach planning it for you.
--   * A planned day keeps its own copy of the routine's exercises (assignment_items).
--     Changing or deleting the routine later doesn't rewrite a day already planned,
--     and a client never needs to read their coach's routines.
--   * A plan is done when a workout is logged that day, so it can't disagree with
--     the log. Only "skipped" is stored.
--   * One plan per person per day, as there is one session per day.

/* ------------------------------------------------------------------ tables */

create table public.templates (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  notes      text check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index templates_name on public.templates (owner_id, lower(name));

-- Targets are what the routine asks for. Reps can be a range, like 8-10.
create table public.template_items (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references public.templates (id) on delete cascade,
  position     integer not null default 0,
  exercise_id  uuid not null references public.exercises (id) on delete cascade,
  variant      text check (char_length(variant) <= 100),
  target_sets  smallint check (target_sets between 1 and 20),
  target_reps  text check (target_reps ~ '^[0-9]{1,3}(-[0-9]{1,3})?$'),
  target_tempo text check (target_tempo ~ '^[0-9X]-[0-9X]-[0-9X]-[0-9X]$'),
  notes        text check (char_length(notes) <= 300)
);
create index template_items_template on public.template_items (template_id, position);

create table public.assignments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  date        date not null,
  name        text not null check (char_length(name) between 1 and 60),
  notes       text check (char_length(notes) <= 500),
  template_id uuid references public.templates (id) on delete set null,
  assigned_by uuid references public.profiles (id) on delete set null,
  skipped_at  timestamptz,
  created_at  timestamptz not null default now()
);
create unique index assignments_one_per_day on public.assignments (user_id, date);

create table public.assignment_items (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  position      integer not null default 0,
  exercise_id   uuid not null references public.exercises (id) on delete cascade,
  variant       text check (char_length(variant) <= 100),
  target_sets   smallint check (target_sets between 1 and 20),
  target_reps   text check (target_reps ~ '^[0-9]{1,3}(-[0-9]{1,3})?$'),
  target_tempo  text check (target_tempo ~ '^[0-9X]-[0-9X]-[0-9X]-[0-9X]$'),
  notes         text check (char_length(notes) <= 300)
);
create index assignment_items_assignment on public.assignment_items (assignment_id, position);
create index assignment_items_exercise on public.assignment_items (exercise_id);

alter table public.templates        enable row level security;
alter table public.template_items   enable row level security;
alter table public.assignments      enable row level security;
alter table public.assignment_items enable row level security;

/* ---------------------------------------------------------------- helpers */

-- Plans are seen wherever workouts are: by the owner, and whoever they share workouts with.
create function public.can_read_assignment(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.assignments a
    where a.id = p_id and (a.user_id = auth.uid() or public.shares(a.user_id, 'workouts')))
$$;

-- A coach's custom exercise in a plan has to be readable by the client it was planned for.
create function public.exercise_in_readable_plan(p_exercise uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.assignment_items ai
    join public.assignments a on a.id = ai.assignment_id
    where ai.exercise_id = p_exercise
      and (a.user_id = auth.uid() or public.shares(a.user_id, 'workouts')))
$$;

/* --------------------------------------------------------------- policies */

create policy templates_own on public.templates for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- A routine may hold built-in exercises and its owner's own custom ones.
create policy template_items_own on public.template_items for all to authenticated
  using (exists (select 1 from public.templates t where t.id = template_id and t.owner_id = auth.uid()))
  with check (
    exists (select 1 from public.templates t where t.id = template_id and t.owner_id = auth.uid())
    and exists (select 1 from public.exercises e where e.id = exercise_id and (not e.is_custom or e.created_by = auth.uid())));

create policy assignments_read on public.assignments for select to authenticated
  using (user_id = auth.uid() or public.shares(user_id, 'workouts'));
create policy assignment_items_read on public.assignment_items for select to authenticated
  using (public.can_read_assignment(assignment_id));

drop policy exercises_read on public.exercises;
create policy exercises_read on public.exercises for select to authenticated
  using (not is_custom or created_by = auth.uid()
         or public.shares(created_by, 'workouts')
         or public.exercise_in_readable_log(id)
         or public.exercise_in_readable_plan(id));

/* -------------------------------------------------------------- functions */

-- Saves a routine and its exercises in one go. Runs as the caller, so the policies
-- above decide what's allowed. Returns the routine's id.
create function public.save_routine(p_id uuid, p_name text, p_notes text, p_items jsonb) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_routine' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 40 then
    raise exception 'too_many_items' using errcode = '22023';
  end if;

  insert into public.templates (id, owner_id, name, notes)
  values (v_id, auth.uid(), trim(p_name), nullif(trim(p_notes), ''))
  on conflict (id) do update set name = excluded.name, notes = excluded.notes, updated_at = now()
    where public.templates.owner_id = auth.uid();
  if not found then
    raise exception 'no_such_routine' using errcode = '42501';
  end if;

  delete from public.template_items where template_id = v_id;
  insert into public.template_items (template_id, position, exercise_id, variant, target_sets, target_reps, target_tempo, notes)
  select v_id, (i.n - 1)::integer, (i.item ->> 'exercise_id')::uuid,
         nullif(trim(i.item ->> 'variant'), ''),
         (i.item ->> 'target_sets')::smallint,
         nullif(trim(i.item ->> 'target_reps'), ''),
         nullif(upper(trim(i.item ->> 'target_tempo')), ''),
         nullif(trim(i.item ->> 'notes'), '')
  from jsonb_array_elements(p_items) with ordinality as i(item, n);
  return v_id;
end $$;

-- Puts one of your routines on a day: your own, or a client's when you may log
-- workouts for them. A day already planned is only replaced when asked to, and
-- only by someone who could remove that plan.
create function public.plan_routine(p_template_id uuid, p_user_id uuid, p_date date, p_replace boolean default false)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_template public.templates;
  v_existing public.assignments;
  v_id uuid;
begin
  select * into v_template from public.templates where id = p_template_id and owner_id = auth.uid();
  if not found then
    raise exception 'no_such_routine' using errcode = '22023';
  end if;
  if p_user_id is distinct from auth.uid() and not public.coach_writes(p_user_id, 'workouts') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.template_items where template_id = p_template_id) then
    raise exception 'empty_routine' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || p_date::text, 7));
  select * into v_existing from public.assignments where user_id = p_user_id and date = p_date;
  if found then
    if not p_replace or not (v_existing.user_id = auth.uid() or v_existing.assigned_by = auth.uid()) then
      raise exception 'already_planned' using errcode = '22023';
    end if;
    delete from public.assignments where id = v_existing.id;
  end if;

  insert into public.assignments (user_id, date, name, notes, template_id, assigned_by)
  values (p_user_id, p_date, v_template.name, v_template.notes, v_template.id, auth.uid())
  returning id into v_id;

  insert into public.assignment_items (assignment_id, position, exercise_id, variant, target_sets, target_reps, target_tempo, notes)
  select v_id, position, exercise_id, variant, target_sets, target_reps, target_tempo, notes
  from public.template_items where template_id = p_template_id;

  if p_user_id <> auth.uid() then
    perform public.notify_person(p_user_id, 'plan_added',
      jsonb_build_object('assignment_id', v_id, 'date', p_date, 'name', v_template.name));
  end if;
  return v_id;
end $$;

-- The owner can clear any plan from their log. A coach can remove the ones they made
-- while they're still allowed to log for that client.
create function public.remove_plan(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.assignments;
begin
  select * into v from public.assignments where id = p_id;
  if not found or not (v.user_id = auth.uid()
                       or (v.assigned_by = auth.uid() and public.coach_writes(v.user_id, 'workouts'))) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  delete from public.assignments where id = p_id;
  if v.user_id <> auth.uid() then
    perform public.notify_person(v.user_id, 'plan_removed', jsonb_build_object('date', v.date, 'name', v.name));
  end if;
end $$;

-- Only the owner says a day was skipped.
create function public.skip_plan(p_id uuid, p_skipped boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.assignments set skipped_at = case when p_skipped then now() end
  where id = p_id and user_id = auth.uid();
  if not found then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
end $$;

/* ----------------------------------------------------------------- grants */

grant select, insert, update, delete on public.templates, public.template_items to authenticated;
grant select on public.assignments, public.assignment_items to authenticated;
grant execute on function
  public.can_read_assignment(uuid), public.exercise_in_readable_plan(uuid),
  public.save_routine(uuid, text, text, jsonb), public.plan_routine(uuid, uuid, date, boolean),
  public.remove_plan(uuid), public.skip_plan(uuid, boolean)
  to authenticated;
