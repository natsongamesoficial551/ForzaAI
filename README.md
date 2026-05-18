# ForzaAI

Aplicação ForzaAI migrada para rodar localmente e no Netlify.

## Desenvolvimento

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Variáveis de ambiente

Configure localmente e no Netlify:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DEEPSEEK_API_KEY`
- `NVIDIA_API_KEY`
- `ENCRYPTION_KEY` (32 bytes em hex ou base64 para criptografar segredos de usuários)
- `STRIPE_SANDBOX_API_KEY`
- `STRIPE_LIVE_API_KEY`
- `PAYMENTS_SANDBOX_WEBHOOK_SECRET`
- `PAYMENTS_LIVE_WEBHOOK_SECRET`

Flags opcionais para liberar fases sem quebrar produção:

- `DASHBOARD_V2_ENABLED`
- `AI_WIZARD_ENABLED`
- `NVIDIA_MODEL_ENABLED`
- `CREDITS_STORE_ENABLED`
- `CONNECTORS_ENABLED`
- `DOMAINS_ENABLED`
- `SKILLS_ENABLED`
- `COLLABORATION_ENABLED`
- `CUSTOM_AI_ENABLED`
