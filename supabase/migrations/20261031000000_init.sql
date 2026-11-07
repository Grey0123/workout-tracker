-- WorkoutTracker v2: schema and access rules (PRD 0.9, sections 4, 8 and 9).
--
-- Differences from the PRD's data model sketch:
--   * session_exercises sits between sessions and sets. v1 rows carry a variant
--     and notes per exercise, tempo is "set once per exercise in a session", and
--     the mockups tag "Edited by Coach" per exercise. Sets alone can't hold those.
--   * sessions gains title (mockups show "Push", "Legs"), meals gains notes (v1).
--   * edit_history gains owner_id and op, so access rules needn't parse before/after.
--   * templates, assignments and progress_photos wait for M7, their milestone.
--
-- Connections and invites have no write policies yet: nobody can create or alter
-- one until the M3 functions exist, so the sharing rules fail closed until then.

/* ------------------------------------------------------------------- types */

create type public.account_type      as enum ('user', 'coach');
create type public.unit_system       as enum ('kg', 'lb');
create type public.connection_kind   as enum ('friend', 'coach');
create type public.connection_status as enum ('pending', 'active', 'revoked');
create type public.coach_access      as enum ('add_edit', 'full');
create type public.exercise_kind     as enum ('weighted', 'bodyweight', 'timed', 'cardio', 'session', 'custom');
create type public.meal_slot         as enum ('morning', 'afternoon', 'evening');
create type public.set_side          as enum ('left', 'right');
create type public.note_kind         as enum ('private', 'reminder', 'goal', 'weekly_plan', 'day');

/* ------------------------------------------------------------------ tables */

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text not null unique check (username ~ '^[a-z0-9_]{3,30}$'),
  display_name text not null check (char_length(display_name) between 1 and 60),
  account_type public.account_type not null default 'user',
  units        public.unit_system not null default 'kg',
  coach_disclaimer_accepted_at timestamptz,
  created_at   timestamptz not null default now(),
  check (account_type <> 'coach' or coach_disclaimer_accepted_at is not null)
);

create table public.connections (
  id        uuid primary key default gen_random_uuid(),
  owner_id  uuid not null references public.profiles (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  kind      public.connection_kind not null,
  status    public.connection_status not null default 'pending',
  coach_access        public.coach_access not null default 'add_edit',
  coach_access_set_at timestamptz,
  -- Friends see workouts only until the owner ticks more on (decision 2026-10-29).
  share_workouts        boolean not null default true,
  share_meals           boolean not null default false,
  share_meal_photos     boolean not null default false,
  share_bodyweight      boolean not null default false,
  share_progress_photos boolean not null default false,
  created_at timestamptz not null default now(),
  check (owner_id <> viewer_id)
);
create unique index connections_one_coach
  on public.connections (owner_id) where kind = 'coach' and status = 'active';
create unique index connections_one_per_pair
  on public.connections (owner_id, viewer_id) where status <> 'revoked';
create index connections_viewer on public.connections (viewer_id, status);

create table public.invites (
  code       text primary key,
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  kind       public.connection_kind not null,
  expires_at timestamptz not null
);

create table public.exercises (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (char_length(name) between 1 and 100),
  category          text not null check (category in (
    'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Forearms & grip', 'Quads', 'Hamstrings',
    'Glutes & hips', 'Calves', 'Core & abs', 'Full body & conditioning', 'Cardio',
    'Sports & classes', 'Mobility & recovery')),
  secondary_muscles text[] not null default '{}',
  equipment         text,
  kind              public.exercise_kind not null,
  inputs            text[] not null check (
    cardinality(inputs) > 0
    and inputs <@ array['weight_kg', 'reps', 'duration_s', 'distance_km', 'rounds', 'tempo', 'rpe', 'calories']),
  per_side          boolean not null default false,
  is_custom         boolean not null default false,
  created_by        uuid references public.profiles (id) on delete cascade,
  check (is_custom = (created_by is not null)),
  check (not is_custom or char_length(name) <= 60)
);
create unique index exercises_builtin_name on public.exercises (lower(name)) where not is_custom;
create unique index exercises_custom_name  on public.exercises (created_by, lower(name)) where is_custom;

create table public.sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  date       date not null,
  title      text check (char_length(title) <= 100),
  notes      text check (char_length(notes) <= 500),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete set null
);
create index sessions_user_date on public.sessions (user_id, date);

create table public.session_exercises (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.sessions (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete restrict,
  position    integer not null default 0,
  variant     text check (char_length(variant) <= 100),
  notes       text check (char_length(notes) <= 500),
  tempo       text check (tempo ~ '^[0-9X]-[0-9X]-[0-9X]-[0-9X]$'),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now()
);
create index session_exercises_session  on public.session_exercises (session_id, position);
create index session_exercises_exercise on public.session_exercises (exercise_id);

create table public.sets (
  id                  uuid primary key default gen_random_uuid(),
  session_exercise_id uuid not null references public.session_exercises (id) on delete cascade,
  set_no      integer not null check (set_no > 0),
  weight_kg   numeric(6, 2) check (weight_kg >= 0),
  reps        integer check (reps >= 0),
  duration_s  integer check (duration_s >= 0),
  tempo       text check (tempo ~ '^[0-9X]-[0-9X]-[0-9X]-[0-9X]$'),   -- overrides the exercise's tempo
  distance_km numeric(7, 3) check (distance_km >= 0),
  rounds      integer check (rounds >= 0),
  rpe         numeric(3, 1) check (rpe between 1 and 10),
  calories    integer check (calories >= 0),
  side        public.set_side,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now()
);
create index sets_session_exercise on public.sets (session_exercise_id, set_no);

create table public.meals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  date        date not null,
  slot        public.meal_slot not null,
  description text check (char_length(description) <= 300),
  notes       text check (char_length(notes) <= 500),
  photo_path  text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  uuid references public.profiles (id) on delete set null
);
-- One entry per slot per day. A soft-deleted meal doesn't hold its slot.
create unique index meals_one_per_slot on public.meals (user_id, date, slot) where deleted_at is null;

create table public.bodyweight (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  date    date not null,
  kg      numeric(5, 2) not null check (kg > 0),
  unique (user_id, date)
);

create table public.workout_media (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  session_id  uuid not null references public.sessions (id) on delete cascade,
  exercise_id uuid references public.exercises (id) on delete set null,
  path        text not null,
  duration_s  integer check (duration_s between 1 and 60),
  created_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index workout_media_session on public.workout_media (session_id);

create table public.coach_notes (
  id         uuid primary key default gen_random_uuid(),
  coach_id   uuid not null references public.profiles (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       public.note_kind not null,
  body       text not null check (char_length(body) between 1 and 2000),
  date       date,
  week_start date,
  pinned     boolean not null default false,
  done_at    timestamptz,
  created_at timestamptz not null default now()
);
create index coach_notes_user on public.coach_notes (user_id, kind);

create table public.evaluations (
  id                 uuid primary key default gen_random_uuid(),
  coach_id           uuid not null references public.profiles (id) on delete cascade,
  user_id            uuid not null references public.profiles (id) on delete cascade,
  period_start       date not null,
  period_end         date not null,
  feedback           text not null check (char_length(feedback) <= 5000),
  rating_training    smallint check (rating_training between 1 and 5),
  rating_nutrition   smallint check (rating_nutrition between 1 and 5),
  rating_consistency smallint check (rating_consistency between 1 and 5),
  next_goals         text[] not null default '{}',
  created_at         timestamptz not null default now(),
  check (period_end >= period_start)
);
create index evaluations_user on public.evaluations (user_id, period_end desc);

create table public.edit_history (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  table_name text not null,
  row_id     uuid not null,
  op         text not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now(),
  before     jsonb,
  after      jsonb
);
create index edit_history_owner on public.edit_history (owner_id, changed_at desc);
create index edit_history_row   on public.edit_history (table_name, row_id, changed_at desc);

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  type       text not null,
  actor_id   uuid references public.profiles (id) on delete set null,
  payload    jsonb not null default '{}',
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user on public.notifications (user_id, created_at desc);

/* ----------------------------------------------------------- access helpers */

-- SECURITY DEFINER so policies can read connections and sessions without
-- recursing through those tables' own policies. All of them ask about auth.uid().

create function public.shares(p_owner uuid, p_what text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.connections c
    where c.owner_id = p_owner and c.viewer_id = auth.uid() and c.status = 'active'
      and case p_what
            when 'workouts'        then c.share_workouts
            when 'meals'           then c.share_meals
            when 'meal_photos'     then c.share_meal_photos
            when 'bodyweight'      then c.share_bodyweight
            when 'progress_photos' then c.share_progress_photos
            else false
          end)
$$;

create function public.is_coach_of(p_owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.connections c
    where c.owner_id = p_owner and c.viewer_id = auth.uid()
      and c.kind = 'coach' and c.status = 'active')
$$;

-- A coach's write powers follow what the owner shares: no sharing meals, no editing meals.
create function public.coach_writes(p_owner uuid, p_what text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_coach_of(p_owner) and public.shares(p_owner, p_what)
$$;

create function public.coach_has_full(p_owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.connections c
    where c.owner_id = p_owner and c.viewer_id = auth.uid()
      and c.kind = 'coach' and c.status = 'active' and c.coach_access = 'full')
$$;

-- Former coaches stay visible to the client, so "Edited by Coach X" keeps its
-- name after a disconnect. The reverse isn't true: a kicked coach keeps nothing.
create function public.can_see_profile(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_id = auth.uid() or exists (
    select 1 from public.connections c
    where (c.status <> 'revoked'
           and ((c.owner_id = auth.uid() and c.viewer_id = p_id)
             or (c.owner_id = p_id and c.viewer_id = auth.uid())))
       or (c.kind = 'coach' and c.owner_id = auth.uid() and c.viewer_id = p_id))
$$;

create function public.can_read_session(p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sessions s
    where s.id = p_session
      and (s.user_id = auth.uid()
           or (s.deleted_at is null and public.shares(s.user_id, 'workouts'))))
$$;

create function public.can_write_session(p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sessions s
    where s.id = p_session
      and (s.user_id = auth.uid()
           or (s.deleted_at is null and public.coach_writes(s.user_id, 'workouts'))))
$$;

create function public.can_delete_in_session(p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sessions s
    where s.id = p_session
      and (s.user_id = auth.uid()
           or (s.deleted_at is null
               and public.coach_writes(s.user_id, 'workouts')
               and public.coach_has_full(s.user_id))))
$$;

-- The session a set belongs to.
create function public.session_of_entry(p_session_exercise uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select session_id from public.session_exercises where id = p_session_exercise
$$;

-- Custom exercises are private, so a log may only point at one its owner or
-- their coach made. Otherwise a known id could expose someone else's exercise.
create function public.can_use_exercise(p_exercise uuid, p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.exercises e
    join public.sessions s on s.id = p_session
    where e.id = p_exercise
      and (not e.is_custom
           or e.created_by = auth.uid()
           or e.created_by = s.user_id
           or exists (
             select 1 from public.connections c
             where c.owner_id = s.user_id and c.viewer_id = e.created_by
               and c.kind = 'coach' and c.status = 'active')))
$$;

create function public.exercise_in_readable_log(p_exercise uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.session_exercises se
    where se.exercise_id = p_exercise and public.can_read_session(se.session_id))
$$;

-- Storage paths start with the owner's id: <owner>/<file>.
create function public.storage_shared(p_name text, p_what text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.connections c
    where c.owner_id::text = (storage.foldername(p_name))[1]
      and c.viewer_id = auth.uid() and c.status = 'active'
      and case p_what
            when 'workouts'    then c.share_workouts
            when 'meal_photos' then c.share_meal_photos
            else false
          end)
$$;

/* ----------------------------------------------------------------- triggers */

-- Who added or edited an entry can't be spoofed by the client: the database
-- stamps it. auth.uid() is null only for trusted server work such as the v1
-- import, which sets created_by itself.
create function public.stamp_entry() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.updated_by := new.created_by;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Entries can't move to another person, and soft delete and restore go through
-- their functions, which run as the table owner rather than as "authenticated".
create function public.guard_owned_entry() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if current_user = 'authenticated' then
      new.deleted_at := null;
      new.deleted_by := null;
    end if;
    return new;
  end if;
  if new.user_id <> old.user_id then
    raise exception 'an entry cannot change owner' using errcode = '42501';
  end if;
  if current_user = 'authenticated'
     and (new.deleted_at is distinct from old.deleted_at
          or new.deleted_by is distinct from old.deleted_by) then
    raise exception 'use soft_delete_entry or restore_entry' using errcode = '42501';
  end if;
  return new;
end $$;

create function public.guard_session_exercise_parent() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.session_id <> old.session_id then
    raise exception 'an exercise cannot move to another session' using errcode = '42501';
  end if;
  return new;
end $$;

create function public.guard_set_parent() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.session_exercise_id <> old.session_exercise_id then
    raise exception 'a set cannot move to another exercise' using errcode = '42501';
  end if;
  return new;
end $$;

-- Writes the edit history and, when someone other than the owner made the
-- change, tells the owner exactly what changed. This lives in the database so a
-- coach can't change an entry without the client being notified.
create function public.audit_entry() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor  uuid := auth.uid();
  v_owner  uuid;
  v_id     uuid;
  v_before jsonb;
  v_after  jsonb;
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
  values (v_owner, tg_table_name, v_id, tg_op, v_actor, v_before, v_after);

  if v_actor <> v_owner then
    insert into public.notifications (user_id, type, actor_id, payload)
    values (v_owner, 'coach_change', v_actor, jsonb_build_object(
      'table', tg_table_name, 'row_id', v_id, 'op', tg_op, 'before', v_before, 'after', v_after));
  end if;
  return null;
end $$;

-- A deleted exercise takes its sets with it, and by the time those rows are
-- audited the parent is gone. Record them first, or their values are lost.
create function public.audit_sets_before_exercise_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then
    return old;
  end if;
  select s.user_id into v_owner from public.sessions s where s.id = old.session_id;
  if v_owner is not null then
    insert into public.edit_history (owner_id, table_name, row_id, op, changed_by, before)
    select v_owner, 'sets', x.id, 'DELETE', auth.uid(), to_jsonb(x)
    from public.sets x where x.session_exercise_id = old.id;
  end if;
  return old;
end $$;

create function public.notify_client() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'coach_notes' then
    -- Nested, not an AND: plpgsql would evaluate new.kind for evaluations too.
    if new.kind = 'private' then
      return null;
    end if;
  end if;
  insert into public.notifications (user_id, type, actor_id, payload)
  values (new.user_id,
          case tg_table_name when 'coach_notes' then 'coach_note' else 'evaluation' end,
          new.coach_id,
          jsonb_build_object('table', tg_table_name, 'row_id', new.id));
  return null;
end $$;

create trigger stamp before insert or update on public.sessions          for each row execute function public.stamp_entry();
create trigger stamp before insert or update on public.session_exercises for each row execute function public.stamp_entry();
create trigger stamp before insert or update on public.sets              for each row execute function public.stamp_entry();
create trigger stamp before insert or update on public.meals             for each row execute function public.stamp_entry();

create trigger guard before insert or update on public.sessions for each row execute function public.guard_owned_entry();
create trigger guard before insert or update on public.meals    for each row execute function public.guard_owned_entry();
create trigger guard before update on public.session_exercises  for each row execute function public.guard_session_exercise_parent();
create trigger guard before update on public.sets               for each row execute function public.guard_set_parent();

create trigger audit after insert or update or delete on public.sessions          for each row execute function public.audit_entry();
create trigger audit after insert or update or delete on public.session_exercises for each row execute function public.audit_entry();
create trigger audit after insert or update or delete on public.sets              for each row execute function public.audit_entry();
create trigger audit after insert or update or delete on public.meals             for each row execute function public.audit_entry();

create trigger audit_sets before delete on public.session_exercises for each row execute function public.audit_sets_before_exercise_delete();

create trigger notify after insert on public.coach_notes for each row execute function public.notify_client();
create trigger notify after insert on public.evaluations for each row execute function public.notify_client();

/* ---------------------------------------------------------------- functions */

-- A profile is created with every account. Coaches must have accepted the
-- self-declared notice (PRD 4.1), so the sign-up form can't skip it.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_type text  := coalesce(v_meta ->> 'account_type', 'user');
begin
  if v_type not in ('user', 'coach') then
    raise exception 'invalid account type';
  end if;
  if v_type = 'coach' and v_meta ->> 'coach_disclaimer_accepted' is distinct from 'true' then
    raise exception 'coach accounts must accept the self-declared notice';
  end if;
  insert into public.profiles (id, username, display_name, account_type, coach_disclaimer_accepted_at)
  values (new.id,
          lower(v_meta ->> 'username'),
          v_meta ->> 'display_name',
          v_type::public.account_type,
          case when v_type = 'coach' then now() end);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Owners and Full control coaches. Not-found and not-allowed look the same, so
-- this can't be used to probe whether someone's entry exists.
create function public.soft_delete_entry(p_table text, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_scope text;
begin
  if p_table = 'sessions' then
    v_scope := 'workouts';
    select user_id into v_owner from public.sessions where id = p_id and deleted_at is null;
  elsif p_table = 'meals' then
    v_scope := 'meals';
    select user_id into v_owner from public.meals where id = p_id and deleted_at is null;
  else
    raise exception 'unsupported table' using errcode = '22023';
  end if;

  if v_owner is null
     or not (v_owner = auth.uid()
             or (public.coach_has_full(v_owner) and public.coach_writes(v_owner, v_scope))) then
    raise exception 'entry not found or not allowed' using errcode = '42501';
  end if;

  if p_table = 'sessions' then
    update public.sessions set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  else
    update public.meals set deleted_at = now(), deleted_by = auth.uid() where id = p_id;
  end if;
end $$;

-- Only the owner restores.
create function public.restore_entry(p_table text, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_found integer;
begin
  if p_table = 'sessions' then
    update public.sessions set deleted_at = null, deleted_by = null
    where id = p_id and user_id = auth.uid() and deleted_at is not null;
  elsif p_table = 'meals' then
    update public.meals set deleted_at = null, deleted_by = null
    where id = p_id and user_id = auth.uid() and deleted_at is not null;
  else
    raise exception 'unsupported table' using errcode = '22023';
  end if;
  get diagnostics v_found = row_count;
  if v_found = 0 then
    raise exception 'entry not found or not allowed' using errcode = '42501';
  end if;
end $$;

-- The one thing a client may change on a coach's note.
create function public.set_reminder_done(p_id uuid, p_done boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_found integer;
begin
  update public.coach_notes
  set done_at = case when p_done then now() end
  where id = p_id and user_id = auth.uid() and kind = 'reminder';
  get diagnostics v_found = row_count;
  if v_found = 0 then
    raise exception 'reminder not found or not allowed' using errcode = '42501';
  end if;
end $$;

/* ----------------------------------------------------------- row-level rules */

alter table public.profiles          enable row level security;
alter table public.connections       enable row level security;
alter table public.invites           enable row level security;
alter table public.exercises         enable row level security;
alter table public.sessions          enable row level security;
alter table public.session_exercises enable row level security;
alter table public.sets              enable row level security;
alter table public.meals             enable row level security;
alter table public.bodyweight        enable row level security;
alter table public.workout_media     enable row level security;
alter table public.coach_notes       enable row level security;
alter table public.evaluations       enable row level security;
alter table public.edit_history      enable row level security;
alter table public.notifications     enable row level security;

create policy profiles_read   on public.profiles for select to authenticated using (public.can_see_profile(id));
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy connections_read on public.connections for select to authenticated
  using (owner_id = auth.uid() or viewer_id = auth.uid());

create policy invites_read on public.invites for select to authenticated using (owner_id = auth.uid());

create policy exercises_read on public.exercises for select to authenticated
  using (not is_custom or created_by = auth.uid()
         or public.shares(created_by, 'workouts')
         or public.exercise_in_readable_log(id));
create policy exercises_insert on public.exercises for insert to authenticated
  with check (is_custom and created_by = auth.uid());
create policy exercises_update on public.exercises for update to authenticated
  using (is_custom and created_by = auth.uid())
  with check (is_custom and created_by = auth.uid());
create policy exercises_delete on public.exercises for delete to authenticated
  using (is_custom and created_by = auth.uid());

create policy sessions_read on public.sessions for select to authenticated
  using (user_id = auth.uid() or (deleted_at is null and public.shares(user_id, 'workouts')));
create policy sessions_insert on public.sessions for insert to authenticated
  with check (user_id = auth.uid() or public.coach_writes(user_id, 'workouts'));
create policy sessions_update on public.sessions for update to authenticated
  using (user_id = auth.uid() or (deleted_at is null and public.coach_writes(user_id, 'workouts')))
  with check (user_id = auth.uid() or public.coach_writes(user_id, 'workouts'));
create policy sessions_delete on public.sessions for delete to authenticated
  using (user_id = auth.uid());

create policy session_exercises_read on public.session_exercises for select to authenticated
  using (public.can_read_session(session_id));
create policy session_exercises_insert on public.session_exercises for insert to authenticated
  with check (public.can_write_session(session_id) and public.can_use_exercise(exercise_id, session_id));
create policy session_exercises_update on public.session_exercises for update to authenticated
  using (public.can_write_session(session_id))
  with check (public.can_write_session(session_id) and public.can_use_exercise(exercise_id, session_id));
create policy session_exercises_delete on public.session_exercises for delete to authenticated
  using (public.can_delete_in_session(session_id));

create policy sets_read on public.sets for select to authenticated
  using (public.can_read_session(public.session_of_entry(session_exercise_id)));
create policy sets_insert on public.sets for insert to authenticated
  with check (public.can_write_session(public.session_of_entry(session_exercise_id)));
create policy sets_update on public.sets for update to authenticated
  using (public.can_write_session(public.session_of_entry(session_exercise_id)))
  with check (public.can_write_session(public.session_of_entry(session_exercise_id)));
create policy sets_delete on public.sets for delete to authenticated
  using (public.can_delete_in_session(public.session_of_entry(session_exercise_id)));

create policy meals_read on public.meals for select to authenticated
  using (user_id = auth.uid() or (deleted_at is null and public.shares(user_id, 'meals')));
create policy meals_insert on public.meals for insert to authenticated
  with check (user_id = auth.uid() or public.coach_writes(user_id, 'meals'));
create policy meals_update on public.meals for update to authenticated
  using (user_id = auth.uid() or (deleted_at is null and public.coach_writes(user_id, 'meals')))
  with check (user_id = auth.uid() or public.coach_writes(user_id, 'meals'));
create policy meals_delete on public.meals for delete to authenticated
  using (user_id = auth.uid());

create policy bodyweight_read on public.bodyweight for select to authenticated
  using (user_id = auth.uid() or public.shares(user_id, 'bodyweight'));
create policy bodyweight_insert on public.bodyweight for insert to authenticated with check (user_id = auth.uid());
create policy bodyweight_update on public.bodyweight for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy bodyweight_delete on public.bodyweight for delete to authenticated using (user_id = auth.uid());

create policy workout_media_read on public.workout_media for select to authenticated
  using (user_id = auth.uid() or (public.shares(user_id, 'workouts') and public.can_read_session(session_id)));
create policy workout_media_insert on public.workout_media for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.sessions s where s.id = session_id and s.user_id = auth.uid()));
create policy workout_media_delete on public.workout_media for delete to authenticated using (user_id = auth.uid());

create policy coach_notes_coach on public.coach_notes for all to authenticated
  using (coach_id = auth.uid() and public.is_coach_of(user_id))
  with check (coach_id = auth.uid() and public.is_coach_of(user_id));
-- Sent notes stay in the client's history after a disconnect (PRD 4).
create policy coach_notes_client on public.coach_notes for select to authenticated
  using (user_id = auth.uid() and kind <> 'private');

create policy evaluations_coach on public.evaluations for all to authenticated
  using (coach_id = auth.uid() and public.is_coach_of(user_id))
  with check (coach_id = auth.uid() and public.is_coach_of(user_id));
create policy evaluations_client on public.evaluations for select to authenticated
  using (user_id = auth.uid());

-- A coach reads their own changes only while connected: history holds copies of
-- the client's data, and a removed coach keeps none of it.
create policy edit_history_read on public.edit_history for select to authenticated
  using (owner_id = auth.uid() or (changed_by = auth.uid() and public.is_coach_of(owner_id)));

create policy notifications_read on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

/* --------------------------------------------------------------------- grants */

-- Supabase grants new objects to anon and authenticated by default. Nothing here
-- is public, and some tables are narrower than the policies alone can express.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select, insert, update, delete on
  public.exercises, public.sessions, public.session_exercises, public.sets, public.meals,
  public.bodyweight, public.coach_notes, public.evaluations
  to authenticated;
grant select, insert, delete on public.workout_media to authenticated;
grant select on public.connections, public.invites, public.edit_history to authenticated;
grant select on public.profiles to authenticated;
grant update (username, display_name, units) on public.profiles to authenticated;   -- not account_type
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

grant execute on function
  public.shares(uuid, text), public.is_coach_of(uuid), public.coach_writes(uuid, text),
  public.coach_has_full(uuid), public.can_see_profile(uuid), public.can_read_session(uuid),
  public.can_write_session(uuid), public.can_delete_in_session(uuid), public.session_of_entry(uuid),
  public.can_use_exercise(uuid, uuid), public.exercise_in_readable_log(uuid),
  public.storage_shared(text, text),
  public.soft_delete_entry(text, uuid), public.restore_entry(text, uuid),
  public.set_reminder_done(uuid, boolean)
  to authenticated;

/* -------------------------------------------------------------------- storage */

-- Private buckets. Files are read through signed URLs, under these same rules.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('meal-photos',   'meal-photos',   false,  5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('workout-media', 'workout-media', false, 52428800, array['video/mp4', 'video/webm', 'video/quicktime']);

create policy media_read on storage.objects for select to authenticated
  using ((bucket_id in ('meal-photos', 'workout-media') and (storage.foldername(name))[1] = auth.uid()::text)
         or (bucket_id = 'meal-photos'   and public.storage_shared(name, 'meal_photos'))
         or (bucket_id = 'workout-media' and public.storage_shared(name, 'workouts')));
create policy media_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('meal-photos', 'workout-media') and (storage.foldername(name))[1] = auth.uid()::text);
create policy media_update on storage.objects for update to authenticated
  using (bucket_id in ('meal-photos', 'workout-media') and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id in ('meal-photos', 'workout-media') and (storage.foldername(name))[1] = auth.uid()::text);
create policy media_delete on storage.objects for delete to authenticated
  using (bucket_id in ('meal-photos', 'workout-media') and (storage.foldername(name))[1] = auth.uid()::text);
