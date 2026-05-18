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
  preferFast?: boolean;
}): RoutedAiModel {
  const thoughtLevel = opts.thoughtLevel ?? "light";
  const multiplier = getCreditMultiplier(thoughtLevel);
  const nvidiaKey = getOptionalServerEnv("NVIDIA_API_KEY");
  const deepSeekKey = getOptionalServerEnv("DEEPSEEK_API_KEY");

  if (opts.preferFast && nvidiaKey) {
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

  if (opts.hasSubscription && deepSeekKey && thoughtLevel === "high") {
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

  if (!deepSeekKey) throw new Error("DEEPSEEK_API_KEY is not configured");

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
