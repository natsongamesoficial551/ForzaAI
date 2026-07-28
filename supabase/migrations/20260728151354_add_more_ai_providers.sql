-- Expande os modelos ForzaAI para incluir os novos provedores:
--   Nvidia NIM (openai-compatible): minimaxai e nemotron
--   OpenRouter (openai-compatible): deepseek-v4-pro, free, glm-5.2, qwen3.7-plus, claude-fable-5, claude-sonnet-5
--   OpenCode Free (openai-compatible): oc/deepseek-v4-flash-free
-- Os identificadores upstream foram preservados literalmente conforme pedido do admin.

alter table public.ai_provider_settings
  drop constraint if exists ai_provider_settings_forza_model_id_check;

alter table public.ai_provider_settings
  add constraint ai_provider_settings_forza_model_id_check
  check (forza_model_id in (
    'forza-1-flash',
    'forza-1-pro',
    'forza-2-pro',
    'forza-2-5-thinking',
    'forza-nim-minimax',
    'forza-nim-nemotron',
    'forza-openrouter-deepseek-pro',
    'forza-openrouter-free',
    'forza-openrouter-glm',
    'forza-openrouter-qwen',
    'forza-openrouter-claude-fable',
    'forza-openrouter-claude-sonnet',
    'forza-opencode-free-flash'
  ));

insert into public.ai_provider_settings (
  forza_model_id, provider, label, endpoint, upstream_model,
  requires_subscription, credit_multiplier, is_enabled
) values
  ('forza-nim-minimax', 'openai-compatible', 'Nvidia NIM · MiniMax-M3',
   'https://integrate.api.nvidia.com/v1/chat/completions',
   'nvidia/minimaxai/minimax-m3', false, 1.5, true),

  ('forza-nim-nemotron', 'openai-compatible', 'Nvidia NIM · Nemotron 3 Ultra 550B-A55B',
   'https://integrate.api.nvidia.com/v1/chat/completions',
   'nvidia/nvidia/nemotron-3-ultra-550b-a55b', false, 3, true),

  ('forza-openrouter-deepseek-pro', 'openai-compatible', 'OpenRouter · DeepSeek V4 Pro',
   'https://openrouter.ai/api/v1/chat/completions',
   'deepseek/deepseek-v4-pro', false, 2.5, true),

  ('forza-openrouter-free', 'openai-compatible', 'OpenRouter · Free',
   'https://openrouter.ai/api/v1/chat/completions',
   'openrouter/free', false, 1, true),

  ('forza-openrouter-glm', 'openai-compatible', 'OpenRouter · GLM 5.2',
   'https://openrouter.ai/api/v1/chat/completions',
   'z-ai/glm-5.2', false, 1.5, true),

  ('forza-openrouter-qwen', 'openai-compatible', 'OpenRouter · Qwen 3.7 Plus',
   'https://openrouter.ai/api/v1/chat/completions',
   'qwen/qwen3.7-plus', false, 1.5, true),

  ('forza-openrouter-claude-fable', 'openai-compatible', 'OpenRouter · Claude Fable 5',
   'https://openrouter.ai/api/v1/chat/completions',
   'anthropic/claude-fable-5', false, 2.5, true),

  ('forza-openrouter-claude-sonnet', 'openai-compatible', 'OpenRouter · Claude Sonnet 5',
   'https://openrouter.ai/api/v1/chat/completions',
   'anthropic/claude-sonnet-5', false, 3, true),

  ('forza-opencode-free-flash', 'openai-compatible', 'OpenCode Free · DeepSeek V4 Flash',
   'https://opencode.ai/api/v1/chat/completions',
   'oc/deepseek-v4-flash-free', false, 1, true)
on conflict (forza_model_id) do nothing;
