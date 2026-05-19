import { getOptionalServerEnv } from "./server-env";

export type ThoughtLevel = "light" | "medium" | "high" | "max";
export type ForzaModelId = "forza-1-flash" | "forza-1-pro" | "forza-2-pro" | "forza-2-5-thinking";

export type RoutedAiModel = {
  id: ForzaModelId;
  label: string;
  provider: "nvidia" | "deepseek";
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

export function routeAiModel(opts: {
  hasSubscription: boolean;
  thoughtLevel?: ThoughtLevel;
  modelId?: ForzaModelId;
  preferFast?: boolean;
}): RoutedAiModel {
  const requestedModel = opts.modelId ?? (opts.preferFast ? "forza-1-flash" : "forza-1-pro");
  const thoughtLevel = opts.thoughtLevel ?? (requestedModel === "forza-2-5-thinking" ? "max" : requestedModel === "forza-2-pro" ? "high" : "light");
  const multiplier = getCreditMultiplier(thoughtLevel);
  const nvidiaKey = getOptionalServerEnv("NVIDIA_API_KEY");
  const deepSeekKey = getOptionalServerEnv("DEEPSEEK_API_KEY");

  if ((requestedModel === "forza-2-pro" || requestedModel === "forza-2-5-thinking") && !opts.hasSubscription) {
    throw new Error("Esse modelo é exclusivo para assinantes Pro.");
  }

  if (requestedModel === "forza-1-flash") {
    if (!nvidiaKey) throw new Error("NVIDIA_API_KEY is not configured");
    return {
      id: "forza-1-flash",
      label: "Forza 1.0 Flash",
      provider: "nvidia",
      endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
      upstreamModel: "zai-org/glm-4.5-air",
      apiKey: nvidiaKey,
      creditMultiplier: multiplier,
      requiresSubscription: false,
    };
  }

  if (!deepSeekKey) throw new Error("DEEPSEEK_API_KEY is not configured");

  if (requestedModel === "forza-2-pro") {
    return {
      id: "forza-2-pro",
      label: "Forza 2.0 Pro",
      provider: "deepseek",
      endpoint: "https://api.deepseek.com/v1/chat/completions",
      upstreamModel: "deepseek-v4-pro",
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
    upstreamModel: "deepseek-v4-flash",
    apiKey: deepSeekKey,
    creditMultiplier: multiplier,
    requiresSubscription: false,
  };
}
