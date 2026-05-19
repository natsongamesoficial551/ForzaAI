import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getOptionalServerEnv } from "./server-env";

export type ThoughtLevel = "light" | "medium" | "high" | "max";
export type ForzaModelId = "forza-1-flash" | "forza-1-pro" | "forza-2-pro" | "forza-2-5-thinking";

export type RoutedAiModel = {
  id: ForzaModelId;
  label: string;
  provider: "deepseek" | "openai-compatible";
  endpoint: string;
  upstreamModel: string;
  apiKey: string;
  creditMultiplier: number;
  requiresSubscription: boolean;
};

const thoughtMultipliers: Record<ThoughtLevel, number> = {
  light: 1,
  medium: 1.5,
  high: 2.5,
  max: 4,
};

export function getCreditMultiplier(level: ThoughtLevel = "light"): number {
  return thoughtMultipliers[level];
}

function defaultDeepSeekModel(
  requestedModel: ForzaModelId,
  multiplier: number,
  deepSeekKey: string,
): RoutedAiModel {
  if (requestedModel === "forza-1-flash") {
    return {
      id: "forza-1-flash",
      label: "Forza 1.0 Flash",
      provider: "deepseek",
      endpoint: "https://api.deepseek.com/v1/chat/completions",
      upstreamModel: "deepseek-chat",
      apiKey: deepSeekKey,
      creditMultiplier: multiplier,
      requiresSubscription: false,
    };
  }

  if (requestedModel === "forza-2-pro") {
    return {
      id: "forza-2-pro",
      label: "Forza 2.0 Pro",
      provider: "deepseek",
      endpoint: "https://api.deepseek.com/v1/chat/completions",
      upstreamModel: "deepseek-chat",
      apiKey: deepSeekKey,
      creditMultiplier: multiplier,
      requiresSubscription: true,
    };
  }

  if (requestedModel === "forza-2-5-thinking") {
    return {
      id: "forza-2-5-thinking",
      label: "Forza 2.5 Thinking",
      provider: "deepseek",
      endpoint: "https://api.deepseek.com/v1/chat/completions",
      upstreamModel: "deepseek-reasoner",
      apiKey: deepSeekKey,
      creditMultiplier: multiplier,
      requiresSubscription: true,
    };
  }

  return {
    id: "forza-1-pro",
    label: "Forza 1.0 Pro",
    provider: "deepseek",
    endpoint: "https://api.deepseek.com/v1/chat/completions",
    upstreamModel: "deepseek-chat",
    apiKey: deepSeekKey,
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
  const thoughtLevel = opts.thoughtLevel ?? (requestedModel === "forza-2-5-thinking" ? "max" : requestedModel === "forza-2-pro" ? "high" : "light");
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
    const apiKey = setting.api_key || (setting.provider === "deepseek" ? deepSeekKey : null);
    if (!apiKey) throw new Error(`API key não configurada para ${setting.label}.`);
    return {
      id: requestedModel,
      label: setting.label,
      provider: setting.provider === "deepseek" ? "deepseek" : "openai-compatible",
      endpoint: setting.endpoint,
      upstreamModel: setting.upstream_model,
      apiKey,
      creditMultiplier: Number(setting.credit_multiplier || multiplier),
      requiresSubscription: setting.requires_subscription,
    };
  }

  if ((requestedModel === "forza-2-pro" || requestedModel === "forza-2-5-thinking") && !opts.hasSubscription) {
    throw new Error("Esse modelo é exclusivo para assinantes Pro.");
  }
  if (!deepSeekKey) throw new Error("DEEPSEEK_API_KEY is not configured");
  return defaultDeepSeekModel(requestedModel, multiplier, deepSeekKey);
}
