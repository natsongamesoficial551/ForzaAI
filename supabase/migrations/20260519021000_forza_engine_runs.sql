create table if not exists public.engine_runs (
  id uuid primary key default gen_random_uuid(),
  generation_job_id uuid references public.generation_jobs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null default 'create' check (mode in ('create', 'edit', 'review', 'full_stack')),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  phase text not null default 'queued',
  brief text not null,
  plan jsonb,
  current_version_id uuid,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.engine_tasks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.engine_runs(id) on delete cascade,
  position integer not null,
  phase text not null,
  title text not null,
  description text not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  input jsonb,
  output jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(run_id, position)
);

create table if not exists public.project_file_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  run_id uuid references public.engine_runs(id) on delete set null,
  version_number integer not null,
  label text not null,
  summary text,
  files jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(project_id, version_number)
);

alter table public.engine_runs
  add constraint engine_runs_current_version_fk
  foreign key (current_version_id) references public.project_file_versions(id) on delete set null;

create table if not exists public.engine_artifacts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.engine_runs(id) on delete cascade,
  kind text not null check (kind in ('brief', 'product_plan', 'technical_plan', 'task_plan', 'validation_report', 'model_raw_output')),
  content jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.engine_runs enable row level security;
alter table public.engine_tasks enable row level security;
alter table public.project_file_versions enable row level security;
alter table public.engine_artifacts enable row level security;

create policy "users view editable engine runs" on public.engine_runs
  for select using (public.can_edit_project(project_id, auth.uid()));

create policy "service role manages engine runs" on public.engine_runs
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "users view editable engine tasks" on public.engine_tasks
  for select using (
    exists (
      select 1 from public.engine_runs r
      where r.id = run_id and public.can_edit_project(r.project_id, auth.uid())
    )
  );

create policy "service role manages engine tasks" on public.engine_tasks
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "users view editable file versions" on public.project_file_versions
  for select using (public.can_edit_project(project_id, auth.uid()));

create policy "service role manages file versions" on public.project_file_versions
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "users view editable engine artifacts" on public.engine_artifacts
  for select using (
    exists (
      select 1 from public.engine_runs r
      where r.id = run_id and public.can_edit_project(r.project_id, auth.uid())
    )
  );

create policy "service role manages engine artifacts" on public.engine_artifacts
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index if not exists engine_runs_job_idx on public.engine_runs(generation_job_id);
create index if not exists engine_runs_project_created_idx on public.engine_runs(project_id, created_at desc);
create index if not exists engine_tasks_run_position_idx on public.engine_tasks(run_id, position);
create index if not exists project_file_versions_project_version_idx on public.project_file_versions(project_id, version_number desc);
create index if not exists engine_artifacts_run_kind_idx on public.engine_artifacts(run_id, kind);

create trigger set_updated_at before update on public.engine_runs
  for each row execute function public.update_updated_at_column();

create trigger set_updated_at before update on public.engine_tasks
  for each row execute function public.update_updated_at_column();
