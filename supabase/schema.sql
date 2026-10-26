-- =====================================================================
-- CLEAN SLATE: Drop everything from a previous setup, then recreate.
-- Run this in Supabase SQL Editor to start fresh.
-- =====================================================================

-- Drop old triggers
drop trigger if exists on_auth_user_created_portal_profile on auth.users;
drop trigger if exists protect_application_review_fields on public.applications;
drop trigger if exists note_logbook_submission on public.logbook_entries;

-- Drop old functions
drop function if exists public.create_portal_profile() cascade;
drop function if exists public.protect_application_review_fields() cascade;
drop function if exists public.note_logbook_submission() cascade;
drop function if exists public.is_lecturer() cascade;

-- Drop old storage policies
drop policy if exists "Users can upload their own portal files" on storage.objects;
drop policy if exists "Owners and lecturers can read portal files" on storage.objects;
drop policy if exists "Owners can delete their own portal files" on storage.objects;

-- Drop old RLS policies
drop policy if exists "Profiles are visible to their owner and lecturers" on public.profiles;
drop policy if exists "Students and lecturers can read applications" on public.applications;
drop policy if exists "Students can create their own application" on public.applications;
drop policy if exists "Owners and lecturers can update applications" on public.applications;
drop policy if exists "Students and lecturers can read logbooks" on public.logbook_entries;
drop policy if exists "Students can create their own logbook entries" on public.logbook_entries;
drop policy if exists "Lecturers can update logbooks" on public.logbook_entries;

-- Drop old tables (order matters for foreign keys)
drop table if exists public.logbook_entries cascade;
drop table if exists public.applications cascade;
drop table if exists public.profiles cascade;

-- Drop old storage bucket contents and bucket
delete from storage.objects where bucket_id = 'portal-files';
delete from storage.buckets where id = 'portal-files';

-- =====================================================================
-- RECREATE EVERYTHING
-- =====================================================================

create extension if not exists pgcrypto;

-- 1. Profiles table (linked to auth.users)
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  matric text unique,
  surname text not null default '',
  first_name text not null default '',
  full_name text not null default '',
  email text not null default '',
  role text not null default 'student' check (role in ('student', 'lecturer')),
  created_at timestamptz not null default now()
);

-- 2. Applications table (one per student)
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null unique references public.profiles (id) on delete cascade,
  matric_number text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'Pending' check (status in ('Pending', 'Accepted', 'Denied')),
  lecturer_feedback text not null default '',
  logbook_approved boolean not null default false,
  logbook_status text,
  lecturer_logbook_feedback text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Logbook entries table
create table public.logbook_entries (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  matric text not null,
  payload jsonb not null default '{}'::jsonb,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists applications_matric_number_idx on public.applications (matric_number);
create index if not exists logbook_entries_student_id_idx on public.logbook_entries (student_id);
create index if not exists logbook_entries_matric_idx on public.logbook_entries (matric);

-- =====================================================================
-- FUNCTIONS
-- =====================================================================

-- Check if current user is a lecturer
create or replace function public.is_lecturer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'lecturer'
  );
$$;

revoke all on function public.is_lecturer() from public;
grant execute on function public.is_lecturer() to authenticated;

-- Auto-create profile when a new Auth user is created
create or replace function public.create_portal_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, matric, surname, first_name, full_name, email, role)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'matric', ''),
    coalesce(new.raw_user_meta_data ->> 'surname', ''),
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'contact_email', new.email, ''),
    'student'
  );
  return new;
end;
$$;

create trigger on_auth_user_created_portal_profile
  after insert on auth.users
  for each row execute procedure public.create_portal_profile();

-- Protect lecturer-controlled fields from student overwrites
create or replace function public.protect_application_review_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.logbook_trigger', true) = 'on' then
    return new;
  end if;

  if not public.is_lecturer() then
    if (
      new.student_id is distinct from old.student_id
      or new.matric_number is distinct from old.matric_number
      or (new.status is distinct from old.status and new.status <> 'Pending')
      or (
        new.lecturer_feedback is distinct from old.lecturer_feedback
        and not (new.status = 'Pending' and new.lecturer_feedback = '')
      )
      or new.created_at is distinct from old.created_at
    ) then
      raise exception 'Students cannot change lecturer review fields';
    end if;

    -- Retain lecturer-controlled fields so student resubmissions don't wipe them
    new.logbook_approved := old.logbook_approved;
    new.logbook_status := old.logbook_status;
    new.lecturer_logbook_feedback := old.lecturer_logbook_feedback;
  end if;

  new.updated_at = now();
  return new;
end;
$$;

create trigger protect_application_review_fields
  before update on public.applications
  for each row execute procedure public.protect_application_review_fields();

-- Auto-mark application when a logbook entry is submitted
create or replace function public.note_logbook_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.logbook_trigger', 'on', true);
  update public.applications
  set logbook_status = 'Awaiting lecturer approval',
      logbook_approved = false,
      lecturer_logbook_feedback = null,
      updated_at = now()
  where student_id = new.student_id;
  return new;
end;
$$;

create trigger note_logbook_submission
  after insert on public.logbook_entries
  for each row execute procedure public.note_logbook_submission();

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================

alter table public.profiles enable row level security;
alter table public.applications enable row level security;
alter table public.logbook_entries enable row level security;

create policy "Profiles are visible to their owner and lecturers"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_lecturer()));

create policy "Students and lecturers can read applications"
  on public.applications for select to authenticated
  using (student_id = (select auth.uid()) or (select public.is_lecturer()));

create policy "Students can create their own application"
  on public.applications for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'student'
        and p.matric = matric_number
    )
  );

create policy "Owners and lecturers can update applications"
  on public.applications for update to authenticated
  using (student_id = (select auth.uid()) or (select public.is_lecturer()))
  with check (student_id = (select auth.uid()) or (select public.is_lecturer()));

create policy "Students and lecturers can read logbooks"
  on public.logbook_entries for select to authenticated
  using (student_id = (select auth.uid()) or (select public.is_lecturer()));

create policy "Students can create their own logbook entries"
  on public.logbook_entries for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'student'
        and p.matric = matric
    )
  );

create policy "Lecturers can update logbooks"
  on public.logbook_entries for update to authenticated
  using ((select public.is_lecturer()))
  with check ((select public.is_lecturer()));

-- Table permissions
grant select on public.profiles to authenticated;
grant select, insert, update on public.applications to authenticated;
grant select, insert, update on public.logbook_entries to authenticated;

-- =====================================================================
-- STORAGE BUCKET
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('portal-files', 'portal-files', false)
on conflict (id) do update set public = false;

create policy "Users can upload their own portal files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'portal-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Owners and lecturers can read portal files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'portal-files'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select public.is_lecturer())
    )
  );

create policy "Owners can delete their own portal files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'portal-files'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- =====================================================================
-- BACKFILL: Create profile rows for any Auth users that already exist
-- and promote the lecturer account.
-- =====================================================================

insert into public.profiles (id, matric, surname, first_name, full_name, email, role)
select
  u.id,
  nullif(u.raw_user_meta_data ->> 'matric', ''),
  coalesce(u.raw_user_meta_data ->> 'surname', ''),
  coalesce(u.raw_user_meta_data ->> 'first_name', ''),
  coalesce(u.raw_user_meta_data ->> 'full_name', ''),
  coalesce(u.raw_user_meta_data ->> 'contact_email', u.email, ''),
  'student'
from auth.users u
on conflict (id) do nothing;

-- Promote the internal lecturer account
update public.profiles
set role = 'lecturer'
where id = (
  select id from auth.users
  where lower(email) = 'lecturer@portal.siwes.internal'
  limit 1
);
