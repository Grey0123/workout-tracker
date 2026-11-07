-- Sharing (M3, PRD sections 4 and 4.1): who can see whose log.
--
-- Connections and invites still have no write policies. They change only through
-- the functions below, which check who is asking. Reading them, and everything the
-- connections unlock, stays with the policies in the first migration.
--
-- A connection is one-way: the owner shares their log with the viewer. Either side
-- can ask, the other accepts, and either can end it at any time.

alter table public.connections
  add column requested_by uuid references public.profiles (id) on delete set null,
  -- PRD 4.1: the owner ticked "I understand" on the self-declared coach notice.
  add column coach_notice_accepted_at timestamptz,
  -- The owner agreed this coach replaces their current one (one coach at a time).
  add column replaces_coach boolean not null default false,
  add column responded_at timestamptz,
  add column ended_at timestamptz,
  add column ended_by uuid references public.profiles (id) on delete set null,
  add constraint connections_photos_need_meals check (not share_meal_photos or share_meals);

-- A friend share and a coach request can be pending side by side. A coach sees
-- everything a friend would, so activating the coach one ends the friend one.
drop index public.connections_one_per_pair;
create unique index connections_one_per_pair on public.connections (owner_id, viewer_id, kind) where status <> 'revoked';

-- An invite link is single use. inviter_shares says which way it points: true when
-- the inviter shares their own log, false when they ask to see the opener's, as a
-- coach inviting a client does.
alter table public.invites rename column owner_id to created_by;
alter table public.invites
  add column inviter_shares boolean not null default true,
  add column coach_notice_accepted_at timestamptz,
  add column created_at timestamptz not null default now(),
  add column used_at timestamptz,
  add column used_by uuid references public.profiles (id) on delete set null;

create policy invites_delete on public.invites for delete to authenticated using (created_by = auth.uid());
grant delete on public.invites to authenticated;

/* ---------------------------------------------------------------- helpers */

-- Friends see workouts only until the owner ticks more (decision 2026-10-29). A
-- coach is there to follow training and eating (PRD 2, item 3), so meals start on.
create function public.default_shares(p_kind public.connection_kind) returns jsonb
language sql immutable set search_path = '' as $$
  select case p_kind
    when 'coach' then '{"share_workouts": true, "share_meals": true, "share_meal_photos": true,
                        "share_bodyweight": true, "share_progress_photos": false}'::jsonb
    else '{"share_workouts": true, "share_meals": false, "share_meal_photos": false,
           "share_bodyweight": false, "share_progress_photos": false}'::jsonb
  end
$$;

create function public.notify_person(p_user uuid, p_type text, p_payload jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, type, actor_id, payload)
  select p_user, p_type, auth.uid(), p_payload where p_user is not null
$$;

-- Only keys that are present change. Meal photos can't be on with meals off.
create function public.apply_shares(p_id uuid, p_shares jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_shares is null then
    return;
  end if;
  update public.connections set
    share_workouts        = coalesce((p_shares ->> 'share_workouts')::boolean, share_workouts),
    share_meals           = coalesce((p_shares ->> 'share_meals')::boolean, share_meals),
    share_bodyweight      = coalesce((p_shares ->> 'share_bodyweight')::boolean, share_bodyweight),
    share_progress_photos = coalesce((p_shares ->> 'share_progress_photos')::boolean, share_progress_photos),
    share_meal_photos     = coalesce((p_shares ->> 'share_meal_photos')::boolean, share_meal_photos)
                            and coalesce((p_shares ->> 'share_meals')::boolean, share_meals)
  where id = p_id;
end $$;

-- Who may be connected how, apart from duplicates.
create function public.check_pair(p_owner uuid, p_viewer uuid, p_kind public.connection_kind) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_owner = p_viewer then
    raise exception 'self' using errcode = '22023';
  end if;
  if p_kind = 'coach' and not exists (
    select 1 from public.profiles where id = p_viewer and account_type = 'coach') then
    raise exception 'not_a_coach' using errcode = '22023';
  end if;
  if p_kind = 'friend' and exists (
    select 1 from public.connections
    where owner_id = p_owner and viewer_id = p_viewer and kind = 'coach' and status = 'active') then
    raise exception 'already_coach' using errcode = '22023';
  end if;
end $$;

-- Makes a pending connection active. One coach at a time: an existing coach is
-- only replaced when the owner agreed to it.
create function public.activate_connection(p_id uuid, p_replace_coach boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.connections;
  v_old public.connections;
begin
  select * into c from public.connections where id = p_id for update;

  if c.kind = 'coach' then
    if c.coach_notice_accepted_at is null then
      raise exception 'coach_notice' using errcode = '22023';
    end if;
    select * into v_old from public.connections
    where owner_id = c.owner_id and kind = 'coach' and status = 'active' and id <> c.id
    for update;
    if found then
      if not (p_replace_coach or c.replaces_coach) then
        raise exception 'has_coach' using errcode = '22023';
      end if;
      update public.connections set status = 'revoked', ended_at = now(), ended_by = auth.uid() where id = v_old.id;
      perform public.notify_person(v_old.viewer_id, 'coach_removed',
        jsonb_build_object('connection_id', v_old.id, 'owner_id', v_old.owner_id, 'replaced', true));
    end if;
    update public.connections set status = 'revoked', ended_at = now(), ended_by = auth.uid()
    where owner_id = c.owner_id and viewer_id = c.viewer_id and kind = 'friend' and status <> 'revoked';
  end if;

  update public.connections set status = 'active', responded_at = now() where id = p_id;
end $$;

/* ------------------------------------------------------------ connections */

-- Exact username only, so the app can't be used to list everyone.
create function public.find_person(p_username text)
returns table (id uuid, username text, display_name text, account_type public.account_type)
language sql stable security definer set search_path = '' as $$
  select p.id, p.username, p.display_name, p.account_type
  from public.profiles p
  where auth.uid() is not null and p.username = lower(ltrim(trim(p_username), '@'))
$$;

-- p_i_share: true offers my log to them, false asks to see theirs. Only the owner
-- sets what's shared and accepts the coach notice.
create function public.request_connection(
  p_other uuid, p_kind public.connection_kind, p_i_share boolean,
  p_coach_notice boolean default false, p_replace_coach boolean default false, p_shares jsonb default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_owner uuid := case when p_i_share then v_me else p_other end;
  v_viewer uuid := case when p_i_share then p_other else v_me end;
  v_defaults jsonb := public.default_shares(p_kind);
  v_id uuid;
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_other) then
    raise exception 'no_such_person' using errcode = '22023';
  end if;
  perform public.check_pair(v_owner, v_viewer, p_kind);
  if p_kind = 'coach' and p_i_share and not p_coach_notice then
    raise exception 'coach_notice' using errcode = '22023';
  end if;

  insert into public.connections (
    owner_id, viewer_id, kind, status, requested_by, coach_notice_accepted_at, replaces_coach,
    share_workouts, share_meals, share_meal_photos, share_bodyweight, share_progress_photos)
  values (
    v_owner, v_viewer, p_kind, 'pending', v_me,
    case when p_kind = 'coach' and p_i_share then now() end, p_i_share and p_replace_coach,
    (v_defaults ->> 'share_workouts')::boolean, (v_defaults ->> 'share_meals')::boolean,
    (v_defaults ->> 'share_meal_photos')::boolean, (v_defaults ->> 'share_bodyweight')::boolean,
    (v_defaults ->> 'share_progress_photos')::boolean)
  returning id into v_id;

  if p_i_share then
    perform public.apply_shares(v_id, p_shares);
  end if;
  perform public.notify_person(p_other, 'connection_request', jsonb_build_object('connection_id', v_id, 'kind', p_kind));
  return v_id;
exception
  when unique_violation then
    raise exception 'already_connected' using errcode = '23505';
end $$;

-- Only the person who was asked can answer. Declining ends the request quietly.
create function public.respond_connection(
  p_id uuid, p_accept boolean,
  p_coach_notice boolean default false, p_replace_coach boolean default false, p_shares jsonb default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  c public.connections;
begin
  select * into c from public.connections where id = p_id and status = 'pending' for update;
  if not found or v_me is null or v_me not in (c.owner_id, c.viewer_id) or c.requested_by = v_me then
    raise exception 'not found or not allowed' using errcode = '42501';
  end if;

  if not p_accept then
    update public.connections set status = 'revoked', responded_at = now(), ended_at = now(), ended_by = v_me where id = p_id;
    return;
  end if;

  if v_me = c.owner_id then
    if c.kind = 'coach' then
      if not p_coach_notice then
        raise exception 'coach_notice' using errcode = '22023';
      end if;
      update public.connections set coach_notice_accepted_at = now() where id = p_id;
    end if;
    perform public.apply_shares(p_id, p_shares);
  end if;
  perform public.check_pair(c.owner_id, c.viewer_id, c.kind);
  perform public.activate_connection(p_id, v_me = c.owner_id and p_replace_coach);
  perform public.notify_person(c.requested_by, 'connection_accepted', jsonb_build_object('connection_id', p_id, 'kind', c.kind));
end $$;

-- Either side, at any time: cancels a request or ends a connection. Access stops
-- with it, because every rule checks for an active connection.
create function public.end_connection(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  c public.connections;
begin
  select * into c from public.connections where id = p_id and status <> 'revoked' for update;
  if not found or v_me is null or v_me not in (c.owner_id, c.viewer_id) then
    raise exception 'not found or not allowed' using errcode = '42501';
  end if;
  update public.connections set status = 'revoked', ended_at = now(), ended_by = v_me where id = p_id;
  if c.status = 'active' then
    perform public.notify_person(
      case when v_me = c.owner_id then c.viewer_id else c.owner_id end,
      case when c.kind = 'coach' and v_me = c.owner_id then 'coach_removed' else 'connection_ended' end,
      jsonb_build_object('connection_id', p_id, 'kind', c.kind));
  end if;
end $$;

-- The owner decides what each connection sees.
create function public.update_sharing(p_id uuid, p_shares jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.connections where id = p_id and owner_id = auth.uid() and status <> 'revoked') then
    raise exception 'not found or not allowed' using errcode = '42501';
  end if;
  perform public.apply_shares(p_id, p_shares);
end $$;

-- PRD 4.2: the owner picks Add & edit or Full control, and the coach is told.
create function public.set_coach_access(p_id uuid, p_access public.coach_access) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.connections;
begin
  update public.connections set coach_access = p_access, coach_access_set_at = now()
  where id = p_id and owner_id = auth.uid() and kind = 'coach' and status = 'active'
  returning * into c;
  if not found then
    raise exception 'not found or not allowed' using errcode = '42501';
  end if;
  perform public.notify_person(c.viewer_id, 'coach_access_changed', jsonb_build_object('connection_id', p_id, 'access', p_access));
end $$;

/* ---------------------------------------------------------------- invites */

create function public.create_invite(
  p_kind public.connection_kind, p_inviter_shares boolean, p_coach_notice boolean default false
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_code text;
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_kind = 'coach' and not p_inviter_shares
     and not exists (select 1 from public.profiles where id = v_me and account_type = 'coach') then
    raise exception 'not_a_coach' using errcode = '22023';
  end if;
  if p_kind = 'coach' and p_inviter_shares and not p_coach_notice then
    raise exception 'coach_notice' using errcode = '22023';
  end if;
  if (select count(*) from public.invites where created_by = v_me and used_at is null and expires_at > now()) >= 20 then
    raise exception 'too_many_invites' using errcode = '22023';
  end if;

  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.invites (code, created_by, kind, inviter_shares, coach_notice_accepted_at, expires_at)
  values (v_code, v_me, p_kind, p_inviter_shares,
          case when p_kind = 'coach' and p_inviter_shares then now() end, now() + interval '7 days');
  return v_code;
end $$;

-- What the person opening a link needs to decide. Knowing the code is the permission.
create function public.invite_details(p_code text)
returns table (username text, display_name text, account_type public.account_type,
               kind public.connection_kind, inviter_shares boolean, expires_at timestamptz,
               usable boolean, mine boolean)
language sql stable security definer set search_path = '' as $$
  select p.username, p.display_name, p.account_type, i.kind, i.inviter_shares, i.expires_at,
         i.used_at is null and i.expires_at > now(), i.created_by = auth.uid()
  from public.invites i
  join public.profiles p on p.id = i.created_by
  where auth.uid() is not null and i.code = upper(trim(p_code))
$$;

-- Both people agreed: the inviter by making the link, the opener by accepting it.
create function public.accept_invite(
  p_code text, p_coach_notice boolean default false, p_replace_coach boolean default false, p_shares jsonb default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  i public.invites;
  v_owner uuid;
  v_viewer uuid;
  v_defaults jsonb;
  c public.connections;
begin
  select * into i from public.invites where code = upper(trim(p_code)) for update;
  if not found or v_me is null or i.used_at is not null or i.expires_at <= now() then
    raise exception 'invite_invalid' using errcode = '22023';
  end if;
  if i.created_by = v_me then
    raise exception 'own_invite' using errcode = '22023';
  end if;

  v_owner := case when i.inviter_shares then i.created_by else v_me end;
  v_viewer := case when i.inviter_shares then v_me else i.created_by end;
  perform public.check_pair(v_owner, v_viewer, i.kind);
  if i.kind = 'coach' and v_owner = v_me and not p_coach_notice then
    raise exception 'coach_notice' using errcode = '22023';
  end if;

  select * into c from public.connections
  where owner_id = v_owner and viewer_id = v_viewer and kind = i.kind and status <> 'revoked'
  for update;
  if found and c.status = 'active' then
    raise exception 'already_connected' using errcode = '23505';
  end if;

  if not found then
    v_defaults := public.default_shares(i.kind);
    insert into public.connections (
      owner_id, viewer_id, kind, status, requested_by,
      share_workouts, share_meals, share_meal_photos, share_bodyweight, share_progress_photos)
    values (
      v_owner, v_viewer, i.kind, 'pending', i.created_by,
      (v_defaults ->> 'share_workouts')::boolean, (v_defaults ->> 'share_meals')::boolean,
      (v_defaults ->> 'share_meal_photos')::boolean, (v_defaults ->> 'share_bodyweight')::boolean,
      (v_defaults ->> 'share_progress_photos')::boolean)
    returning * into c;
  end if;

  if i.kind = 'coach' then
    update public.connections
    set coach_notice_accepted_at = coalesce(case when v_owner = v_me then now() end, i.coach_notice_accepted_at, coach_notice_accepted_at)
    where id = c.id;
  end if;
  if v_owner = v_me then
    perform public.apply_shares(c.id, p_shares);
  end if;
  perform public.activate_connection(c.id, v_owner = v_me and p_replace_coach);

  update public.invites set used_at = now(), used_by = v_me where code = i.code;
  perform public.notify_person(i.created_by, 'invite_accepted', jsonb_build_object('connection_id', c.id, 'kind', i.kind));
  return c.id;
end $$;

/* ----------------------------------------------------------------- grants */

revoke all on function
  public.default_shares(public.connection_kind),
  public.notify_person(uuid, text, jsonb),
  public.apply_shares(uuid, jsonb),
  public.check_pair(uuid, uuid, public.connection_kind),
  public.activate_connection(uuid, boolean),
  public.find_person(text),
  public.request_connection(uuid, public.connection_kind, boolean, boolean, boolean, jsonb),
  public.respond_connection(uuid, boolean, boolean, boolean, jsonb),
  public.end_connection(uuid),
  public.update_sharing(uuid, jsonb),
  public.set_coach_access(uuid, public.coach_access),
  public.create_invite(public.connection_kind, boolean, boolean),
  public.invite_details(text),
  public.accept_invite(text, boolean, boolean, jsonb)
  from public, anon, authenticated;

grant execute on function
  public.find_person(text),
  public.request_connection(uuid, public.connection_kind, boolean, boolean, boolean, jsonb),
  public.respond_connection(uuid, boolean, boolean, boolean, jsonb),
  public.end_connection(uuid),
  public.update_sharing(uuid, jsonb),
  public.set_coach_access(uuid, public.coach_access),
  public.create_invite(public.connection_kind, boolean, boolean),
  public.invite_details(text),
  public.accept_invite(text, boolean, boolean, jsonb)
  to authenticated;
