-- Configura o ForzaAI pra chamar o OpenCode Free DIRETAMENTE
-- Sem 9router, sem tunnel, sem PC local

update public.ai_provider_settings
set
  provider = 'openai-compatible',
  endpoint = 'https://opencode.ai/api/v1',
  upstream_model = 'oc/deepseek-v4-flash-free',
  api_key = 'sk-82ab709539ffc5f8-75dp4f-3902367b',
  requires_subscription = false,
  credit_multiplier = 1,
  is_enabled = true
where forza_model_id = 'forza-1-flash';

-- Mesma config pros outros modelos (opcional, mesma chave)
update public.ai_provider_settings
set
  provider = 'openai-compatible',
  endpoint = 'https://opencode.ai/api/v1',
  upstream_model = 'oc/deepseek-v4-flash-free',
  api_key = 'sk-82ab709539ffc5f8-75dp4f-3902367b',
  requires_subscription = false,
  credit_multiplier = 1,
  is_enabled = true
where forza_model_id = 'forza-1-pro';

update public.ai_provider_settings
set
  provider = 'openai-compatible',
  endpoint = 'https://opencode.ai/api/v1',
  upstream_model = 'oc/deepseek-v4-flash-free',
  api_key = 'sk-82ab709539ffc5f8-75dp4f-3902367b',
  requires_subscription = false,
  credit_multiplier = 2.5,
  is_enabled = true
where forza_model_id = 'forza-2-pro';

update public.ai_provider_settings
set
  provider = 'openai-compatible',
  endpoint = 'https://opencode.ai/api/v1',
  upstream_model = 'oc/deepseek-v4-flash-free',
  api_key = 'sk-82ab709539ffc5f8-75dp4f-3902367b',
  requires_subscription = false,
  credit_multiplier = 4,
  is_enabled = true
where forza_model_id = 'forza-2-5-thinking';
