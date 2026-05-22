import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { encryptSecret } from "@/lib/secret-crypto";
import { getOptionalServerEnv, getServerEnv } from "@/lib/server-env";
import { verifyGithubOAuthState } from "@/lib/connectors.functions";

function callbackRedirect(request: Request, search: Record<string, string>) {
  const url = new URL("/connectors", new URL(request.url).origin);
  for (const [key, value] of Object.entries(search)) url.searchParams.set(key, value);
  return Response.redirect(url.toString(), 302);
}

async function exchangeCodeForToken(code: string, request: Request) {
  const redirectUri = getOptionalServerEnv("GITHUB_OAUTH_REDIRECT_URI") ?? `${new URL(request.url).origin}/api/connectors/github/callback`;
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
  const data = await response.json() as { access_token?: string; scope?: string; token_type?: string; error?: string };
  if (!response.ok || !data.access_token || data.error) throw new Error("GitHub OAuth token exchange failed");
  return data;
}

async function getGithubUser(accessToken: string) {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${accessToken}`,
      "x-github-api-version": "2022-11-28",
    },
  });
  const data = await response.json() as { id?: number; login?: string; name?: string; avatar_url?: string; html_url?: string };
  if (!response.ok || !data.id || !data.login) throw new Error("GitHub user lookup failed");
  return data;
}

export const Route = createFileRoute("/api/connectors/github/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const code = url.searchParams.get("code");
          const state = url.searchParams.get("state");
          if (!code || !state) callbackRedirect(request, { error: "github_oauth" });

          const userId = await verifyGithubOAuthState(state);
          const token = await exchangeCodeForToken(code, request);
          const githubUser = await getGithubUser(token.access_token);
          const encryptedValue = await encryptSecret(token.access_token);
          const supabase = createClient(getServerEnv("SUPABASE_URL"), getServerEnv("SUPABASE_SERVICE_ROLE_KEY"), {
            auth: { persistSession: false, autoRefreshToken: false },
          });

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

          callbackRedirect(request, { connected: "github" });
        } catch (error) {
          console.error("GitHub OAuth callback failed", error);
          callbackRedirect(request, { error: "github_oauth" });
        }
      },
    },
  },
});
