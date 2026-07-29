-- Remove tudo que tinha antes e fica só 9router
-- O usuário configura os modelos direto pelo 9router em http://localhost:20128/v1

alter table public.ai_provider_settings
  drop constraint if exists ai_provider_settings_forza_model_id_check;

alter table public.ai_provider_settings
  add constraint ai_provider_settings_forza_model_id_check
  check (forza_model_id in (
    'forza-1-flash',
    'forza-1-pro',
    'forza-2-pro',
    'forza-2-5-thinking'
  ));

delete from public.ai_provider_settings;

insert into public.ai_provider_settings (
  forza_model_id, provider, label, endpoint, upstream_model,
  requires_subscription, credit_multiplier, is_enabled
) values
  ('forza-1-flash', '9router', 'Forza 1.0 Flash (9router)',
   'http://localhost:20128/v1/chat/completions', 'deepseek-chat',
   false, 1, true),

  ('forza-1-pro', '9router', 'Forza 1.0 Pro (9router)',
   'http://localhost:20128/v1/chat/completions', 'deepseek-chat',
   false, 1, true),

  ('forza-2-pro', '9router', 'Forza 2.0 Pro (9router)',
   'http://localhost:20128/v1/chat/completions', 'deepseek-chat',
   false, 2.5, true),

  ('forza-2-5-thinking', '9router', 'Forza 2.5 Thinking (9router)',
   'http://localhost:20128/v1/chat/completions', 'deepseek-reasoner',
   false, 4, true)
on conflict (forza_model_id) do nothing;
