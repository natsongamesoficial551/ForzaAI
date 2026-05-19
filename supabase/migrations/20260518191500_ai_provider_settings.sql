create table if not exists public.ai_provider_settings (
  id uuid primary key default gen_random_uuid(),
  forza_model_id text not null unique check (forza_model_id in ('forza-1-flash', 'forza-1-pro', 'forza-2-pro', 'forza-2-5-thinking')),
  provider text not null default 'deepseek',
  label text not null,
  endpoint text not null,
  upstream_model text not null,
  api_key text,
  requires_subscription boolean not null default false,
  credit_multiplier numeric not null default 1 check (credit_multiplier > 0),
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_provider_settings enable row level security;

drop policy if exists "admins view ai provider settings" on public.ai_provider_settings;
create policy "admins view ai provider settings" on public.ai_provider_settings
  for select using (public.is_admin(auth.uid()));

drop policy if exists "service role manages ai provider settings" on public.ai_provider_settings;
create policy "service role manages ai provider settings" on public.ai_provider_settings
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop trigger if exists update_ai_provider_settings_updated_at on public.ai_provider_settings;
create trigger update_ai_provider_settings_updated_at
  before update on public.ai_provider_settings
  for each row execute function public.update_updated_at_column();

insert into public.ai_provider_settings (
  forza_model_id,
  provider,
  label,
  endpoint,
  upstream_model,
  requires_subscription,
  credit_multiplier,
  is_enabled
)
values
  ('forza-1-flash', 'deepseek', 'Forza 1.0 Flash', 'https://api.deepseek.com/v1/chat/completions', 'deepseek-chat', false, 1, true),
  ('forza-1-pro', 'deepseek', 'Forza 1.0 Pro', 'https://api.deepseek.com/v1/chat/completions', 'deepseek-chat', false, 1, true),
  ('forza-2-pro', 'deepseek', 'Forza 2.0 Pro', 'https://api.deepseek.com/v1/chat/completions', 'deepseek-chat', true, 2.5, true),
  ('forza-2-5-thinking', 'deepseek', 'Forza 2.5 Thinking', 'https://api.deepseek.com/v1/chat/completions', 'deepseek-reasoner', true, 4, true)
on conflict (forza_model_id) do nothing;
