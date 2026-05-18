import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { encryptSecret } from "./secret-crypto";

const providers = ["supabase", "stripe", "github", "figma", "custom-ai"] as const;

const SaveConnectorSchema = z.object({
  provider: z.enum(providers),
  secretName: z.string().min(2).max(80),
  secretValue: z.string().min(3).max(4000),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

const DeleteConnectorSchema = z.object({ id: z.string().uuid() });

export const listConnectors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("encrypted_user_secrets")
      .select("id, provider, secret_name, metadata, created_at, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const saveConnectorSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveConnectorSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const encryptedValue = await encryptSecret(data.secretValue);
    const { error } = await supabase.from("encrypted_user_secrets").upsert(
      {
        user_id: userId,
        provider: data.provider,
        secret_name: data.secretName,
        encrypted_value: encryptedValue,
        metadata: data.metadata,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider,secret_name" },
    );
    if (error) throw error;
    return { ok: true };
  });

export const deleteConnectorSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteConnectorSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("encrypted_user_secrets")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const getCustomAiTokenBalance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase.rpc("ensure_custom_ai_tokens");
    if (error) throw error;
    return data ?? 0;
  });
