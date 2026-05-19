create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  model_id text not null check (model_id in ('forza-1-flash', 'forza-1-pro', 'forza-2-pro', 'forza-2-5-thinking')),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  stage text not null default 'Na fila…',
  message text not null,
  error text,
  files_updated integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.generation_jobs enable row level security;

create policy "users view own generation jobs" on public.generation_jobs
  for select using (user_id = auth.uid());

create policy "service role manages generation jobs" on public.generation_jobs
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create index if not exists generation_jobs_project_created_idx
  on public.generation_jobs(project_id, created_at desc);
