import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export const createDeepSeekProvider = (deepSeekApiKey: string) =>
  createOpenAICompatible({
    name: "deepseek",
    baseURL: "https://api.deepseek.com/v1",
    headers: {
      Authorization: `Bearer ${deepSeekApiKey}`,
    },
  });
