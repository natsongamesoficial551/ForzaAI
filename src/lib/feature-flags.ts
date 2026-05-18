import { createServerFn } from "@tanstack/react-start";
import { getServerFlag } from "./server-env";

export const featureFlagKeys = [
  "DASHBOARD_V2_ENABLED",
  "AI_WIZARD_ENABLED",
  "NVIDIA_MODEL_ENABLED",
  "CREDITS_STORE_ENABLED",
  "CONNECTORS_ENABLED",
  "DOMAINS_ENABLED",
  "SKILLS_ENABLED",
  "COLLABORATION_ENABLED",
  "CUSTOM_AI_ENABLED",
] as const;

export type FeatureFlagKey = (typeof featureFlagKeys)[number];
export type FeatureFlags = Record<FeatureFlagKey, boolean>;

export function getServerFeatureFlags(): FeatureFlags {
  return Object.fromEntries(featureFlagKeys.map((key) => [key, getServerFlag(key)])) as FeatureFlags;
}

export const getFeatureFlags = createServerFn({ method: "GET" }).handler(() => getServerFeatureFlags());
