alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
alter table public.profiles add column if not exists recovery_phone text;
alter table public.profiles add column if not exists bio text;

create table if not exists public.project_collaborators (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('viewer','editor')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(project_id, user_id)
);

alter table public.project_collaborators enable row level security;
create index if not exists idx_project_collaborators_project on public.project_collaborators(project_id);
create index if not exists idx_project_collaborators_user on public.project_collaborators(user_id);

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

drop policy if exists "users own project files" on public.project_files;
create policy "users own project files" on public.project_files
  for all
  using (public.can_access_project(project_id, auth.uid()))
  with check (public.can_edit_project(project_id, auth.uid()));

drop policy if exists "users own conversations" on public.conversations;
create policy "users own conversations" on public.conversations
  for all
  using (public.can_access_project(project_id, auth.uid()))
  with check (public.can_edit_project(project_id, auth.uid()));

drop policy if exists "users own messages" on public.messages;
create policy "users own messages" on public.messages
  for all
  using (exists (
    select 1 from public.conversations c
    where c.id = conversation_id and public.can_access_project(c.project_id, auth.uid())
  ))
  with check (exists (
    select 1 from public.conversations c
    where c.id = conversation_id and public.can_edit_project(c.project_id, auth.uid())
  ));

drop policy if exists "users own project memory" on public.project_memory;
create policy "users own project memory" on public.project_memory
  for all
  using (public.can_access_project(project_id, auth.uid()))
  with check (public.can_edit_project(project_id, auth.uid()));

drop policy if exists "owners manage collaborators" on public.project_collaborators;
create policy "owners manage collaborators" on public.project_collaborators
  for all
  using (public.is_project_owner(project_id, auth.uid()))
  with check (public.is_project_owner(project_id, auth.uid()));

drop policy if exists "collaborators view project collaborators" on public.project_collaborators;
create policy "collaborators view project collaborators" on public.project_collaborators
  for select using (user_id = auth.uid() or public.is_project_owner(project_id, auth.uid()));

create or replace function public.debit_project_owner_credits(_project_id uuid, _amount integer, _description text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
  current_balance integer;
begin
  if auth.uid() is null then return false; end if;
  if _amount <= 0 then return false; end if;
  if not public.can_edit_project(_project_id, auth.uid()) then return false; end if;

  select user_id into owner_id from public.projects where id = _project_id;
  if owner_id is null then return false; end if;

  select credits into current_balance from public.profiles where id = owner_id for update;
  if current_balance is null or current_balance < _amount then
    return false;
  end if;

  update public.profiles set credits = credits - _amount where id = owner_id;
  insert into public.credit_transactions (user_id, amount, type, description)
  values (owner_id, _amount, 'debit', _description);
  return true;
end;
$$;

create table if not exists public.ai_skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  prompt text not null,
  is_global boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((is_global = true and user_id is null) or (is_global = false and user_id is not null))
);

alter table public.ai_skills enable row level security;
create index if not exists idx_ai_skills_user on public.ai_skills(user_id);
create index if not exists idx_ai_skills_global on public.ai_skills(is_global) where is_global;

drop policy if exists "users view available skills" on public.ai_skills;
create policy "users view available skills" on public.ai_skills
  for select using (is_global or auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "users manage own skills" on public.ai_skills;
create policy "users manage own skills" on public.ai_skills
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id and is_global = false);

drop policy if exists "admins manage global skills" on public.ai_skills;
create policy "admins manage global skills" on public.ai_skills
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop trigger if exists set_updated_at on public.ai_skills;
create trigger set_updated_at
  before update on public.ai_skills
  for each row execute function public.update_updated_at_column();

create table if not exists public.project_skill_activations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  skill_id uuid not null references public.ai_skills(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(project_id, skill_id)
);

alter table public.project_skill_activations enable row level security;
create index if not exists idx_project_skill_activations_project on public.project_skill_activations(project_id);

drop policy if exists "project editors manage skill activations" on public.project_skill_activations;
create policy "project editors manage skill activations" on public.project_skill_activations
  for all
  using (public.can_edit_project(project_id, auth.uid()))
  with check (public.can_edit_project(project_id, auth.uid()) and auth.uid() = user_id);

drop policy if exists "project users view skill activations" on public.project_skill_activations;
create policy "project users view skill activations" on public.project_skill_activations
  for select using (public.can_access_project(project_id, auth.uid()));

insert into public.ai_skills (is_global, user_id, name, description, prompt)
values
  (true, null, 'UI/UX avançado', 'Melhora hierarquia visual, usabilidade e experiência premium.', 'Priorize UX clara, hierarquia visual forte, microinterações úteis, acessibilidade e fluxo de conversão sem fricção.'),
  (true, null, 'Segurança extrema', 'Orienta a IA a evitar padrões inseguros no código gerado.', 'Evite XSS, injeções, exposição de segredos e validações frágeis. Use padrões seguros no frontend e explique limitações quando necessário.'),
  (true, null, 'SEO automático', 'Aprimora meta tags, semântica e conteúdo indexável.', 'Inclua SEO técnico forte, HTML semântico, meta tags completas, títulos claros, descrições persuasivas e estrutura amigável para buscadores.'),
  (true, null, 'Landing pages modernas', 'Foca em landing pages bonitas e com conversão.', 'Crie landing pages modernas com hero forte, prova social, benefícios claros, CTA repetido, seções escaneáveis e copy persuasiva.'),
  (true, null, 'Backend otimizado', 'Favorece arquitetura futura para backend limpo.', 'Quando houver lógica de backend no escopo, proponha arquitetura simples, segura, escalável e fácil de manter.'),
  (true, null, 'Arquitetura SaaS', 'Direciona soluções para produtos SaaS.', 'Modele funcionalidades como SaaS: onboarding, planos, permissões, painel, métricas, billing e estados vazios úteis quando fizer sentido.'),
  (true, null, 'Sistemas escaláveis', 'Evita decisões difíceis de escalar.', 'Prefira estruturas de código e dados que cresçam sem acoplamento excessivo, mantendo simplicidade e performance.'),
  (true, null, 'Performance extrema', 'Melhora carregamento e fluidez.', 'Otimize CSS, JS e HTML para carregamento rápido, poucas dependências, animações leves e boa responsividade.'),
  (true, null, 'Código limpo', 'Prioriza legibilidade e manutenção.', 'Gere código direto, bem nomeado, sem complexidade desnecessária e com separação clara entre estrutura, estilo e comportamento.'),
  (true, null, 'Design futurista', 'Aplica estética tecnológica premium.', 'Use estética futurista premium com gradientes elegantes, glassmorphism controlado, contraste forte e detalhes visuais sofisticados sem prejudicar legibilidade.')
on conflict do nothing;

create table if not exists public.project_domains (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  domain text not null,
  status text not null default 'pending' check (status in ('pending','verified','active','failed')),
  verification_token text not null default encode(gen_random_bytes(16), 'hex'),
  instructions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(domain)
);

alter table public.project_domains enable row level security;
create index if not exists idx_project_domains_project on public.project_domains(project_id);
create index if not exists idx_project_domains_user on public.project_domains(user_id);

drop policy if exists "project users view domains" on public.project_domains;
create policy "project users view domains" on public.project_domains
  for select using (public.can_access_project(project_id, auth.uid()));

drop policy if exists "project owners manage domains" on public.project_domains;
create policy "project owners manage domains" on public.project_domains
  for all
  using (exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()))
  with check (auth.uid() = user_id and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()));

drop trigger if exists set_updated_at on public.project_domains;
create trigger set_updated_at
  before update on public.project_domains
  for each row execute function public.update_updated_at_column();

create table if not exists public.custom_ai_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.custom_ai_tokens enable row level security;

drop policy if exists "users view own custom ai tokens" on public.custom_ai_tokens;
create policy "users view own custom ai tokens" on public.custom_ai_tokens
  for select using (auth.uid() = user_id);

drop policy if exists "service role manages custom ai tokens" on public.custom_ai_tokens;
create policy "service role manages custom ai tokens"
  on public.custom_ai_tokens for all using (auth.role() = 'service_role');

drop trigger if exists set_updated_at on public.custom_ai_tokens;
create trigger set_updated_at
  before update on public.custom_ai_tokens
  for each row execute function public.update_updated_at_column();

create or replace function public.ensure_custom_ai_tokens()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  current_balance integer;
begin
  if _uid is null then return 0; end if;
  insert into public.custom_ai_tokens (user_id, balance)
  values (_uid, 5)
  on conflict (user_id) do nothing;
  select balance into current_balance from public.custom_ai_tokens where user_id = _uid;
  return coalesce(current_balance, 0);
end;
$$;

create or replace function public.add_custom_ai_tokens(_user_id uuid, _amount integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance integer;
begin
  if _user_id is null then return 0; end if;
  if _amount < 5 or _amount > 200 then return 0; end if;
  insert into public.custom_ai_tokens (user_id, balance)
  values (_user_id, 5)
  on conflict (user_id) do nothing;
  update public.custom_ai_tokens
  set balance = balance + _amount
  where user_id = _user_id
  returning balance into new_balance;
  return coalesce(new_balance, 0);
end;
$$;

revoke execute on function public.can_access_project(uuid, uuid) from public, anon;
revoke execute on function public.can_edit_project(uuid, uuid) from public, anon;
revoke execute on function public.is_project_owner(uuid, uuid) from public, anon;
revoke execute on function public.debit_project_owner_credits(uuid, integer, text) from public, anon;
revoke execute on function public.ensure_custom_ai_tokens() from public, anon;
revoke execute on function public.add_custom_ai_tokens(uuid, integer) from public, anon;
grant execute on function public.can_access_project(uuid, uuid) to authenticated;
grant execute on function public.can_edit_project(uuid, uuid) to authenticated;
grant execute on function public.is_project_owner(uuid, uuid) to authenticated;
grant execute on function public.debit_project_owner_credits(uuid, integer, text) to authenticated;
grant execute on function public.ensure_custom_ai_tokens() to authenticated;
