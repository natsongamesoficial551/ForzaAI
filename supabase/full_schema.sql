create extension if not exists pgcrypto;

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  credits integer not null default 100,
  locale text not null default 'pt-BR',
  sound_enabled boolean not null default true,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
alter table public.profiles add column if not exists recovery_phone text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles enable row level security;

drop policy if exists "users view own profile" on public.profiles;
create policy "users view own profile" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles
  for update using (auth.uid() = id);

drop trigger if exists set_updated_at on public.profiles;
create trigger set_updated_at
  before update on public.profiles
  for each row execute function public.update_updated_at_column();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  site_type text not null default 'landing-page',
  description text,
  status text not null default 'draft',
  deployed_url text,
  slug text unique,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.projects add column if not exists slug text unique;
alter table public.projects add column if not exists published_at timestamptz;
alter table public.projects enable row level security;

create index if not exists idx_projects_user on public.projects(user_id);
create index if not exists projects_slug_idx on public.projects(slug) where slug is not null;

create table if not exists public.project_collaborators (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('viewer','editor')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(project_id, user_id)
);

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

create or replace function public.create_user_project(_name text, _site_type text default 'landing-page', _description text default null)
returns public.projects
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _project public.projects;
begin
  if _uid is null then
    raise exception 'Usuário não autenticado';
  end if;

  insert into public.projects (user_id, name, site_type, description)
  values (
    _uid,
    nullif(trim(_name), ''),
    coalesce(nullif(trim(_site_type), ''), 'landing-page'),
    nullif(trim(coalesce(_description, '')), '')
  )
  returning * into _project;

  return _project;
end;
$$;

drop policy if exists "users own projects" on public.projects;
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

drop trigger if exists set_updated_at on public.projects;
create trigger set_updated_at
  before update on public.projects
  for each row execute function public.update_updated_at_column();

create table if not exists public.project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  path text not null,
  content text not null default '',
  language text not null default 'html',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, path)
);

alter table public.project_files enable row level security;
create index if not exists idx_project_files_project on public.project_files(project_id);

drop policy if exists "users own project files" on public.project_files;
create policy "users own project files" on public.project_files
  for all
  using (public.can_access_project(project_id, auth.uid()))
  with check (public.can_edit_project(project_id, auth.uid()));

drop trigger if exists set_updated_at on public.project_files;
create trigger set_updated_at
  before update on public.project_files
  for each row execute function public.update_updated_at_column();

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.conversations enable row level security;

drop policy if exists "users own conversations" on public.conversations;
create policy "users own conversations" on public.conversations
  for all
  using (public.can_access_project(project_id, auth.uid()))
  with check (public.can_edit_project(project_id, auth.uid()));

drop trigger if exists set_updated_at on public.conversations;
create trigger set_updated_at
  before update on public.conversations
  for each row execute function public.update_updated_at_column();

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  created_at timestamptz not null default now()
);

alter table public.messages enable row level security;
create index if not exists idx_messages_conv on public.messages(conversation_id, created_at);

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

create table if not exists public.project_memory (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  category text not null,
  key text not null,
  value text not null,
  created_at timestamptz not null default now(),
  unique(project_id, key)
);

alter table public.project_memory enable row level security;

drop policy if exists "users own project memory" on public.project_memory;
create policy "users own project memory" on public.project_memory
  for all
  using (public.can_access_project(project_id, auth.uid()))
  with check (public.can_edit_project(project_id, auth.uid()));

create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null,
  type text not null check (type in ('debit','credit','grant','purchase','refund')),
  description text,
  created_at timestamptz not null default now()
);

alter table public.credit_transactions enable row level security;
create index if not exists idx_credit_tx_user on public.credit_transactions(user_id, created_at desc);

drop policy if exists "users view own transactions" on public.credit_transactions;
create policy "users view own transactions" on public.credit_transactions
  for select using (auth.uid() = user_id);

drop function if exists public.debit_credits(uuid, integer, text);
create or replace function public.debit_credits(_amount integer, _description text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance integer;
  _uid uuid := auth.uid();
begin
  if _uid is null then return false; end if;
  if _amount <= 0 then return false; end if;

  select credits into current_balance from public.profiles where id = _uid for update;
  if current_balance is null or current_balance < _amount then
    return false;
  end if;

  update public.profiles set credits = credits - _amount where id = _uid;
  insert into public.credit_transactions (user_id, amount, type, description)
  values (_uid, _amount, 'debit', _description);
  return true;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.debit_credits(integer, text) from public, anon;
grant execute on function public.debit_credits(integer, text) to authenticated;

do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'app_role') then
    create type public.app_role as enum ('admin', 'user');
  end if;
end $$;

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique(user_id, role)
);

alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.is_admin(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(_user_id, 'admin'::public.app_role)
$$;

drop policy if exists "users see own roles" on public.user_roles;
create policy "users see own roles" on public.user_roles
  for select using (auth.uid() = user_id);

drop policy if exists "admins see all roles" on public.user_roles;
create policy "admins see all roles" on public.user_roles
  for select using (public.is_admin(auth.uid()));

drop policy if exists "admins manage roles" on public.user_roles;
create policy "admins manage roles" on public.user_roles
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

create table if not exists public.feature_flags (
  key text primary key,
  enabled boolean not null default false,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.feature_flags enable row level security;

drop policy if exists "admins manage feature flags" on public.feature_flags;
create policy "admins manage feature flags" on public.feature_flags
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop trigger if exists set_updated_at on public.feature_flags;
create trigger set_updated_at
  before update on public.feature_flags
  for each row execute function public.update_updated_at_column();

insert into public.feature_flags (key, enabled, description)
values
  ('DASHBOARD_V2_ENABLED', false, 'Novo dashboard SaaS com sidebar e chat central'),
  ('AI_WIZARD_ENABLED', false, 'Wizard obrigatório gerado por IA após o primeiro prompt'),
  ('NVIDIA_MODEL_ENABLED', false, 'Modelo Forza 1.0 Flash via NVIDIA'),
  ('CREDITS_STORE_ENABLED', false, 'Compra avulsa de créditos'),
  ('CONNECTORS_ENABLED', false, 'Conectores reais de Supabase, Stripe, Figma e GitHub'),
  ('DOMAINS_ENABLED', false, 'Gerenciamento de domínios e slugs públicos'),
  ('SKILLS_ENABLED', false, 'Skills globais e personalizadas para IA'),
  ('COLLABORATION_ENABLED', false, 'Compartilhamento de projetos entre contas'),
  ('CUSTOM_AI_ENABLED', false, 'IA personalizada do usuário com tokens')
on conflict (key) do nothing;

create table if not exists public.encrypted_user_secrets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  secret_name text not null,
  encrypted_value text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, provider, secret_name)
);

alter table public.encrypted_user_secrets enable row level security;
create index if not exists idx_encrypted_user_secrets_user on public.encrypted_user_secrets(user_id);

drop policy if exists "users manage own encrypted secrets" on public.encrypted_user_secrets;
create policy "users manage own encrypted secrets" on public.encrypted_user_secrets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "admins view encrypted secret metadata" on public.encrypted_user_secrets;
create policy "admins view encrypted secret metadata" on public.encrypted_user_secrets
  for select using (public.is_admin(auth.uid()));

drop trigger if exists set_updated_at on public.encrypted_user_secrets;
create trigger set_updated_at
  before update on public.encrypted_user_secrets
  for each row execute function public.update_updated_at_column();

alter table public.project_collaborators enable row level security;
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
  (true, null, 'Design futurista', 'Aplica estética tecnológica premium.', 'Use estética futurista premium com gradientes elegantes, glassmorphism controlado, contraste forte e detalhes visuais sofisticados sem prejudicar legibilidade.'),
  (true, null, 'Modo Professor + Pesquisa', 'Transforma IAs de estudo em tutores precisos com pesquisa.', 'Para assistentes de estudo, ative comportamento de professor: diagnostique nível do aluno, explique passo a passo, cite evidências do documento/print, faça perguntas socráticas, crie exemplos e mini-exercícios. Se a confiança estiver baixa, faltar contexto ou a pergunta depender de fato atual/externo, use modo pesquisa via backend protegido antes de responder; se não houver pesquisa disponível, declare a limitação e responda com hipóteses marcadas.')
on conflict do nothing;

revoke execute on function public.can_access_project(uuid, uuid) from public, anon;
revoke execute on function public.can_edit_project(uuid, uuid) from public, anon;
revoke execute on function public.is_project_owner(uuid, uuid) from public, anon;
revoke execute on function public.create_user_project(text, text, text) from public, anon;
revoke execute on function public.debit_project_owner_credits(uuid, integer, text) from public, anon;
grant execute on function public.can_access_project(uuid, uuid) to authenticated;
grant execute on function public.can_edit_project(uuid, uuid) to authenticated;
grant execute on function public.is_project_owner(uuid, uuid) to authenticated;
grant execute on function public.create_user_project(text, text, text) to authenticated;
grant execute on function public.debit_project_owner_credits(uuid, integer, text) to authenticated;

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
create policy "service role manages custom ai tokens" on public.custom_ai_tokens
  for all using (auth.role() = 'service_role');

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

revoke execute on function public.ensure_custom_ai_tokens() from public, anon;
revoke execute on function public.add_custom_ai_tokens(uuid, integer) from public, anon;
grant execute on function public.ensure_custom_ai_tokens() to authenticated;

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_subscription_id text not null unique,
  stripe_customer_id text not null,
  product_id text not null,
  price_id text not null,
  status text not null default 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean default false,
  environment text not null default 'sandbox',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;
create index if not exists idx_subscriptions_user_id on public.subscriptions(user_id);
create index if not exists idx_subscriptions_stripe_id on public.subscriptions(stripe_subscription_id);

drop policy if exists "users view own subscription" on public.subscriptions;
create policy "users view own subscription" on public.subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists "admins view all subscriptions" on public.subscriptions;
create policy "admins view all subscriptions" on public.subscriptions
  for select using (public.is_admin(auth.uid()));

drop policy if exists "service role manages subscriptions" on public.subscriptions;
create policy "service role manages subscriptions" on public.subscriptions
  for all using (auth.role() = 'service_role');

drop trigger if exists update_subscriptions_updated_at on public.subscriptions;
create trigger update_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.update_updated_at_column();

create or replace function public.has_active_subscription(_user_id uuid, _env text default 'sandbox')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.subscriptions
    where user_id = _user_id
      and environment = _env
      and (
        (status in ('active','trialing') and (current_period_end is null or current_period_end > now()))
        or (status = 'canceled' and current_period_end > now())
      )
  )
$$;

create or replace function public.get_user_plan(_user_id uuid, _env text default 'sandbox')
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case
      when price_id = 'business_monthly' then 'business'
      when price_id = 'pro_monthly' then 'pro'
      else 'free'
    end
    from public.subscriptions
    where user_id = _user_id
      and environment = _env
      and status in ('active','trialing','past_due')
      and (current_period_end is null or current_period_end > now())
    order by created_at desc
    limit 1), 'free')
$$;

create or replace function public.refill_monthly_credits(_user_id uuid, _plan text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_amount integer;
begin
  new_amount := case _plan
    when 'business' then 5000
    when 'pro' then 1000
    else 25
  end;

  update public.profiles set credits = new_amount where id = _user_id;
  insert into public.credit_transactions (user_id, amount, type, description)
  values (_user_id, new_amount, 'credit', 'Plan refill: ' || _plan);
  return new_amount;
end;
$$;

create or replace function public.grant_free_credits(_amount integer, _description text, _max_balance integer default 25)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  new_balance integer;
begin
  if _uid is null then return 0; end if;
  if _amount <= 0 then return 0; end if;

  update public.profiles
  set credits = least(_max_balance, credits + _amount)
  where id = _uid
  returning credits into new_balance;

  if new_balance is not null then
    insert into public.credit_transactions (user_id, amount, type, description)
    values (_uid, _amount, 'grant', _description);
  end if;

  return coalesce(new_balance, 0);
end;
$$;

create or replace function public.add_purchased_credits(_user_id uuid, _amount integer, _description text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance integer;
begin
  if _user_id is null then return 0; end if;
  if _amount <= 0 then return 0; end if;

  update public.profiles
  set credits = credits + _amount
  where id = _user_id
  returning credits into new_balance;

  insert into public.credit_transactions (user_id, amount, type, description)
  values (_user_id, _amount, 'purchase', _description);

  return coalesce(new_balance, 0);
end;
$$;

create or replace function public.assign_admin_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email = 'borgesnatan09@gmail.com' then
    insert into public.user_roles (user_id, role) values (new.id, 'admin')
    on conflict do nothing;
  else
    insert into public.user_roles (user_id, role) values (new.id, 'user')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists assign_admin_on_signup on public.profiles;
create trigger assign_admin_on_signup
  after insert on public.profiles
  for each row execute function public.assign_admin_on_signup();

insert into public.user_roles (user_id, role)
select id, case when email = 'borgesnatan09@gmail.com' then 'admin'::public.app_role else 'user'::public.app_role end
from public.profiles
on conflict do nothing;

insert into storage.buckets (id, name, public)
values ('project-assets', 'project-assets', true)
on conflict (id) do nothing;

drop policy if exists "project-assets public read" on storage.objects;
create policy "project-assets public read"
on storage.objects for select
using (bucket_id = 'project-assets');

drop policy if exists "project-assets owner write" on storage.objects;
create policy "project-assets owner write"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'project-assets'
  and exists (
    select 1 from public.projects p
    where p.id::text = (storage.foldername(name))[1]
      and public.can_edit_project(p.id, auth.uid())
  )
);

drop policy if exists "project-assets owner update" on storage.objects;
create policy "project-assets owner update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'project-assets'
  and exists (
    select 1 from public.projects p
    where p.id::text = (storage.foldername(name))[1]
      and public.can_edit_project(p.id, auth.uid())
  )
);

drop policy if exists "project-assets owner delete" on storage.objects;
create policy "project-assets owner delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'project-assets'
  and exists (
    select 1 from public.projects p
    where p.id::text = (storage.foldername(name))[1]
      and public.can_edit_project(p.id, auth.uid())
  )
);
