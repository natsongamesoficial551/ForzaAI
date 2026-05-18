set lock_timeout = '10s';

alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
alter table public.profiles add column if not exists recovery_phone text;
alter table public.profiles add column if not exists bio text;

create or replace function public.can_access_project(_project_id uuid, _user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.projects p
    where p.id = _project_id and p.user_id = _user_id
  ) or exists (
    select 1 from public.project_collaborators pc
    where pc.project_id = _project_id and pc.user_id = _user_id
  )
$$;

create or replace function public.can_edit_project(_project_id uuid, _user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.projects p
    where p.id = _project_id and p.user_id = _user_id
  ) or exists (
    select 1 from public.project_collaborators pc
    where pc.project_id = _project_id and pc.user_id = _user_id and pc.role = 'editor'
  )
$$;

create or replace function public.is_project_owner(_project_id uuid, _user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.projects p
    where p.id = _project_id and p.user_id = _user_id
  )
$$;

drop policy if exists "users own projects" on public.projects;
drop policy if exists "users insert own projects" on public.projects;
drop policy if exists "project owners and editors update projects" on public.projects;
drop policy if exists "project owners delete projects" on public.projects;

create policy "users own projects" on public.projects
  for select using (public.can_access_project(id, auth.uid()));

create policy "users insert own projects" on public.projects
  for insert with check (auth.uid() = user_id);

create policy "project owners and editors update projects" on public.projects
  for update
  using (public.can_edit_project(id, auth.uid()))
  with check (auth.uid() = user_id or public.can_edit_project(id, auth.uid()));

create policy "project owners delete projects" on public.projects
  for delete using (auth.uid() = user_id);

drop policy if exists "owners manage collaborators" on public.project_collaborators;
drop policy if exists "collaborators view project collaborators" on public.project_collaborators;

create policy "owners manage collaborators" on public.project_collaborators
  for all
  using (public.is_project_owner(project_id, auth.uid()))
  with check (public.is_project_owner(project_id, auth.uid()));

create policy "collaborators view project collaborators" on public.project_collaborators
  for select using (user_id = auth.uid() or public.is_project_owner(project_id, auth.uid()));

revoke execute on function public.can_access_project(uuid, uuid) from public, anon;
revoke execute on function public.can_edit_project(uuid, uuid) from public, anon;
revoke execute on function public.is_project_owner(uuid, uuid) from public, anon;
grant execute on function public.can_access_project(uuid, uuid) to authenticated;
grant execute on function public.can_edit_project(uuid, uuid) to authenticated;
grant execute on function public.is_project_owner(uuid, uuid) to authenticated;
