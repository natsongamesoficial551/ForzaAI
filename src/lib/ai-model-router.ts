import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getOptionalServerEnv } from "./server-env";

export type ThoughtLevel = "light" | "medium" | "high" | "max";
export type ForzaModelId =
  | "forza-1-flash"
  | "forza-1-pro"
  | "forza-2-pro"
  | "forza-2-5-thinking";

export type RoutedAiModel = {
  id: ForzaModelId;
  label: string;
  provider: "9router";
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

export async function routeAiModel(opts: {
  hasSubscription: boolean;
  thoughtLevel?: ThoughtLevel;
  modelId?: ForzaModelId;
  preferFast?: boolean;
}): Promise<RoutedAiModel> {
  const requestedModel = opts.modelId ?? (opts.preferFast ? "forza-1-flash" : "forza-1-pro");
  const thoughtLevel = opts.thoughtLevel ?? (requestedModel === "forza-2-5-thinking" ? "max" : requestedModel === "forza-2-pro" ? "high" : "light");
  const multiplier = getCreditMultiplier(thoughtLevel);
  const envApiKey = getOptionalServerEnv("9ROUTER_API_KEY");

  const { data: setting } = await supabaseAdmin
    .from("ai_provider_settings")
    .select("provider, label, endpoint, upstream_model, api_key, requires_subscription, credit_multiplier, is_enabled")
    .eq("forza_model_id", requestedModel)
    .eq("is_enabled", true)
    .maybeSingle();

  if (!setting) throw new Error(`Modelo ${requestedModel} não configurado no 9router.`);

  const apiKey = setting.api_key || envApiKey;
  if (!apiKey) throw new Error("API key do 9router não configurada. Configure em Admin > Modelos de IA ou na env 9ROUTER_API_KEY.");

  return {
    id: requestedModel,
    label: setting.label,
    provider: "9router",
    endpoint: setting.endpoint,
    upstreamModel: setting.upstream_model,
    apiKey,
    creditMultiplier: Number(setting.credit_multiplier || multiplier),
    requiresSubscription: setting.requires_subscription,
  };
}
