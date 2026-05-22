import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { encryptSecret } from "./secret-crypto";
import { getOptionalServerEnv, getServerEnv } from "./server-env";

const providers = ["supabase", "stripe", "github", "figma", "custom-ai"] as const;
const GITHUB_DEFAULT_SCOPES = "repo read:user user:email";

function toBase64Url(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmacSha256(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(getServerEnv("OAUTH_STATE_SECRET")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return toBase64Url(new Uint8Array(signature));
}

export async function createGithubOAuthState(userId: string): Promise<string> {
  const payload = {
    userId,
    nonce: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  const encodedPayload = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmacSha256(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export async function verifyGithubOAuthState(state: string): Promise<string> {
  const [encodedPayload, signature] = state.split(".");
  if (!encodedPayload || !signature) throw new Error("Invalid OAuth state");
  const expectedSignature = await hmacSha256(encodedPayload);
  if (signature !== expectedSignature) throw new Error("Invalid OAuth state signature");

  const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload))) as {
    userId?: string;
    expiresAt?: number;
  };
  if (!payload.userId || !payload.expiresAt || payload.expiresAt < Date.now()) {
    throw new Error("Expired OAuth state");
  }
  return payload.userId;
}

function githubRedirectUri(requestOrigin?: string): string {
  return getOptionalServerEnv("GITHUB_OAUTH_REDIRECT_URI") ?? `${requestOrigin ?? ""}/api/connectors/github/callback`;
}

const SaveConnectorSchema = z.object({
  provider: z.enum(providers),
  secretName: z.string().min(2).max(80),
  secretValue: z.string().min(3).max(4000),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

const DeleteConnectorSchema = z.object({ id: z.string().uuid() });
const CompleteGithubOAuthSchema = z.object({
  code: z.string().min(10).max(500),
  state: z.string().min(20).max(2000),
});

async function exchangeGithubCodeForToken(code: string, requestOrigin?: string) {
  const redirectUri = githubRedirectUri(requestOrigin);
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      client_id: getServerEnv("GITHUB_OAUTH_CLIENT_ID"),
      client_secret: getServerEnv("GITHUB_OAUTH_CLIENT_SECRET"),
      code,
      redirect_uri: redirectUri,
    }),
  });
  const token = await response.json() as { access_token?: string; scope?: string; token_type?: string; error?: string };
  if (!response.ok || !token.access_token || token.error) throw new Error("GitHub OAuth token exchange failed");
  return token;
}

async function getGithubUser(accessToken: string) {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${accessToken}`,
      "x-github-api-version": "2022-11-28",
    },
  });
  const user = await response.json() as { id?: number; login?: string; name?: string; avatar_url?: string; html_url?: string };
  if (!response.ok || !user.id || !user.login) throw new Error("GitHub user lookup failed");
  return user;
}

async function saveGithubConnection(supabase: any, userId: string, code: string, requestOrigin?: string) {
  const token = await exchangeGithubCodeForToken(code, requestOrigin);
  const githubUser = await getGithubUser(token.access_token);
  const encryptedValue = await encryptSecret(token.access_token);
  const { error } = await supabase.from("encrypted_user_secrets").upsert(
    {
      user_id: userId,
      provider: "github",
      secret_name: githubUser.login,
      encrypted_value: encryptedValue,
      metadata: {
        accountLogin: githubUser.login,
        githubUserId: githubUser.id,
        name: githubUser.name ?? null,
        avatarUrl: githubUser.avatar_url ?? null,
        profileUrl: githubUser.html_url ?? null,
        scopes: token.scope?.split(",").filter(Boolean) ?? [],
        tokenType: token.token_type ?? "bearer",
        connectedAt: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider,secret_name" },
  );
  if (error) throw error;
  return { accountLogin: githubUser.login };
}

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

export const startGithubOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const clientId = getServerEnv("GITHUB_OAUTH_CLIENT_ID");
    const request = getRequest();
    const requestOrigin = request?.url ? new URL(request.url).origin : undefined;
    const redirectUri = githubRedirectUri(requestOrigin);
    const scopes = getOptionalServerEnv("GITHUB_OAUTH_SCOPES") ?? GITHUB_DEFAULT_SCOPES;
    const state = await createGithubOAuthState(context.userId);
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", scopes);
    url.searchParams.set("state", state);
    url.searchParams.set("allow_signup", "true");
    return { url: url.toString() };
  });

export const completeGithubOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CompleteGithubOAuthSchema.parse(input))
  .handler(async ({ data, context }) => {
    const stateUserId = await verifyGithubOAuthState(data.state);
    if (stateUserId !== context.userId) throw new Error("GitHub OAuth state does not match current user");
    const request = getRequest();
    const requestOrigin = request?.url ? new URL(request.url).origin : undefined;
    return saveGithubConnection(context.supabase, context.userId, data.code, requestOrigin);
  });

export const getCustomAiTokenBalance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase.rpc("ensure_custom_ai_tokens");
    if (error) throw error;
    return data ?? 0;
  });
