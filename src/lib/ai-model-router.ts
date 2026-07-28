import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getOptionalServerEnv } from "./server-env";

export type ThoughtLevel = "light" | "medium" | "high" | "max";
export type ForzaModelId =
  | "forza-1-flash"
  | "forza-1-pro"
  | "forza-2-pro"
  | "forza-2-5-thinking"
  | "forza-nim-minimax"
  | "forza-nim-nemotron"
  | "forza-openrouter-deepseek-pro"
  | "forza-openrouter-free"
  | "forza-openrouter-glm"
  | "forza-openrouter-qwen"
  | "forza-openrouter-claude-fable"
  | "forza-openrouter-claude-sonnet"
  | "forza-opencode-free-flash";

export type AiProviderKind = "deepseek" | "nvidia-nim" | "openrouter" | "opencode-free" | "openai-compatible";

export type RoutedAiModel = {
  id: ForzaModelId;
  label: string;
  provider: AiProviderKind;
  endpoint: string;
  upstreamModel: string;
  apiKey: string;
  creditMultiplier: number;
  requiresSubscription: boolean;
  estimatedContextWindow: number;
};

const thoughtMultipliers: Record<ThoughtLevel, number> = {
  light: 1,
  medium: 1.5,
  high: 2.5,
  max: 4,
};

const FORZA_PRO_MODEL_IDS: ReadonlySet<ForzaModelId> = new Set([
  "forza-2-pro",
  "forza-2-5-thinking",
]);

const PROVIDER_ENDPOINT_HINTS: Record<AiProviderKind, RegExp> = {
  deepseek: /api\.deepseek\.com/,
  "nvidia-nim": /integrate\.api\.nvidia\.com/,
  openrouter: /openrouter\.ai\/api\/v1/,
  "opencode-free": /opencode\.ai\/api\/v1/,
  "openai-compatible": /^(?!.*(?:api\.deepseek\.com|integrate\.api\.nvidia\.com|openrouter\.ai\/api\/v1|opencode\.ai\/api\/v1)).+$/,
};

const PROVIDER_CONTEXT_WINDOWS: Record<AiProviderKind, number> = {
  deepseek: 128_000,
  "nvidia-nim": 128_000,
  openrouter: 200_000,
  "opencode-free": 64_000,
  "openai-compatible": 64_000,
};

const envKeyForProvider = (provider: AiProviderKind): string | undefined => {
  switch (provider) {
    case "deepseek":
      return getOptionalServerEnv("DEEPSEEK_API_KEY");
    case "nvidia-nim":
      return getOptionalServerEnv("NVIDIA_NIM_API_KEY") ?? getOptionalServerEnv("NVIDIA_API_KEY");
    case "openrouter":
      return getOptionalServerEnv("OPENROUTER_API_KEY");
    case "opencode-free":
      return getOptionalServerEnv("OPENCODE_API_KEY");
    default:
      return undefined;
  }
};

const normalizeProviderKind = (raw: string, endpoint: string): AiProviderKind => {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "deepseek" || /api\.deepseek\.com/.test(endpoint)) return "deepseek";
  if (value === "nvidia-nim" || value === "nvidia" || /integrate\.api\.nvidia\.com/.test(endpoint)) return "nvidia-nim";
  if (value === "openrouter" || /openrouter\.ai\/api\/v1/.test(endpoint)) return "openrouter";
  if (value === "opencode-free" || value === "opencode" || /opencode\.ai\/api\/v1/.test(endpoint)) return "opencode-free";
  return "openai-compatible";
};

export function getCreditMultiplier(level: ThoughtLevel = "light"): number {
  return thoughtMultipliers[level];
}

export function getEstimatedContextWindow(provider: AiProviderKind): number {
  return PROVIDER_CONTEXT_WINDOWS[provider] ?? 64_000;
}

function defaultDeepSeekModel(
  requestedModel: ForzaModelId,
  multiplier: number,
  deepSeekKey: string,
): RoutedAiModel {
  const base = {
    endpoint: "https://api.deepseek.com/v1/chat/completions",
    provider: "deepseek" as AiProviderKind,
    apiKey: deepSeekKey,
    estimatedContextWindow: PROVIDER_CONTEXT_WINDOWS.deepseek,
  };
  if (requestedModel === "forza-1-flash") {
    return {
      ...base,
      id: "forza-1-flash",
      label: "Forza 1.0 Flash",
      upstreamModel: "deepseek-chat",
      creditMultiplier: multiplier,
      requiresSubscription: false,
    };
  }

  if (requestedModel === "forza-2-pro") {
    return {
      ...base,
      id: "forza-2-pro",
      label: "Forza 2.0 Pro",
      upstreamModel: "deepseek-chat",
      creditMultiplier: multiplier,
      requiresSubscription: true,
    };
  }

  if (requestedModel === "forza-2-5-thinking") {
    return {
      ...base,
      id: "forza-2-5-thinking",
      label: "Forza 2.5 Thinking",
      upstreamModel: "deepseek-reasoner",
      creditMultiplier: multiplier,
      requiresSubscription: true,
    };
  }

  return {
    ...base,
    id: "forza-1-pro",
    label: "Forza 1.0 Pro",
    upstreamModel: "deepseek-chat",
    creditMultiplier: multiplier,
    requiresSubscription: false,
  };
}

export async function routeAiModel(opts: {
  hasSubscription: boolean;
  thoughtLevel?: ThoughtLevel;
  modelId?: ForzaModelId;
  preferFast?: boolean;
}): Promise<RoutedAiModel> {
  const requestedModel = opts.modelId ?? (opts.preferFast ? "forza-1-flash" : "forza-1-pro");
  const thoughtLevel = opts.thoughtLevel ?? (requestedModel === "forza-2-5-thinking" ? "max" : FORZA_PRO_MODEL_IDS.has(requestedModel) ? "high" : "light");
  const multiplier = getCreditMultiplier(thoughtLevel);
  const deepSeekKey = getOptionalServerEnv("DEEPSEEK_API_KEY");

  const { data: setting } = await supabaseAdmin
    .from("ai_provider_settings")
    .select("provider, label, endpoint, upstream_model, api_key, requires_subscription, credit_multiplier, is_enabled")
    .eq("forza_model_id", requestedModel)
    .eq("is_enabled", true)
    .maybeSingle();

  if (setting) {
    if (setting.requires_subscription && !opts.hasSubscription) {
      throw new Error("Esse modelo é exclusivo para assinantes Pro.");
    }
    const provider = normalizeProviderKind(setting.provider, setting.endpoint);
    const apiKey = setting.api_key || envKeyForProvider(provider) || (provider === "deepseek" ? deepSeekKey : null);
    if (!apiKey) throw new Error(`API key não configurada para ${setting.label}.`);
    const expected = PROVIDER_ENDPOINT_HINTS[provider];
    if (expected && expected.test("placeholder") === false && provider !== "openai-compatible" && !expected.test(setting.endpoint)) {
      throw new Error(`Endpoint configurado para ${setting.label} não corresponde ao provedor ${provider}. Verifique a URL na administração.`);
    }
    return {
      id: requestedModel,
      label: setting.label,
      provider,
      endpoint: setting.endpoint,
      upstreamModel: setting.upstream_model,
      apiKey,
      creditMultiplier: Number(setting.credit_multiplier || multiplier),
      requiresSubscription: setting.requires_subscription,
      estimatedContextWindow: PROVIDER_CONTEXT_WINDOWS[provider] ?? 64_000,
    };
  }

  if (FORZA_PRO_MODEL_IDS.has(requestedModel) && !opts.hasSubscription) {
    throw new Error("Esse modelo é exclusivo para assinantes Pro.");
  }
  if (!deepSeekKey) throw new Error("DEEPSEEK_API_KEY is not configured");
  return defaultDeepSeekModel(requestedModel, multiplier, deepSeekKey);
}
