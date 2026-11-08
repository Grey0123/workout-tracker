-- Progress photos (M7; PRD 5.4 Body: "progress photos side by side").
--
-- Only the owner adds or removes them. Others see them only where the owner ticked
-- "Progress photos" for that person, which is off for friends and coaches alike
-- (decision 2026-10-29).

create type public.photo_pose as enum ('front', 'side', 'back', 'other');

create table public.progress_photos (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  date       date not null,
  pose       public.photo_pose not null default 'front',
  path       text not null check (split_part(path, '/', 1) = user_id::text),
  note       text check (char_length(note) <= 200),
  created_at timestamptz not null default now()
);
create index progress_photos_user on public.progress_photos (user_id, date);

alter table public.progress_photos enable row level security;

create policy progress_photos_read on public.progress_photos for select to authenticated
  using (user_id = auth.uid() or public.shares(user_id, 'progress_photos'));
create policy progress_photos_insert on public.progress_photos for insert to authenticated
  with check (user_id = auth.uid());
create policy progress_photos_update on public.progress_photos for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy progress_photos_delete on public.progress_photos for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, delete on public.progress_photos to authenticated;
grant update (date, pose, note) on public.progress_photos to authenticated;

/* -------------------------------------------------------------------- storage */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('progress-photos', 'progress-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']);

-- The same as before, with progress photos added.
create or replace function public.storage_shared(p_name text, p_what text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.connections c
    where c.owner_id::text = (storage.foldername(p_name))[1]
      and c.viewer_id = auth.uid() and c.status = 'active'
      and case p_what
            when 'workouts'        then c.share_workouts
            when 'meal_photos'     then c.share_meal_photos
            when 'progress_photos' then c.share_progress_photos
            else false
          end)
$$;

create policy progress_photos_files_read on storage.objects for select to authenticated
  using (bucket_id = 'progress-photos'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.storage_shared(name, 'progress_photos')));
create policy progress_photos_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy progress_photos_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);
