import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getServerEnv } from "./server-env";

const ProjectInputSchema = z.object({ projectId: z.string().uuid() });

const InviteInputSchema = z.object({
  projectId: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(["viewer", "editor"]).default("editor"),
});

const RemoveInputSchema = z.object({
  projectId: z.string().uuid(),
  collaboratorId: z.string().uuid(),
});

function getAdminSupabase() {
  return createClient(getServerEnv("SUPABASE_URL"), getServerEnv("SUPABASE_SERVICE_ROLE_KEY"));
}

async function assertProjectOwner(supabase: any, projectId: string, userId: string) {
  const { data } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) throw new Error("Apenas o dono pode gerenciar colaboradores.");
}

export const listProjectCollaborators = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ProjectInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: canAccess } = await supabase.rpc("can_access_project", {
      _project_id: data.projectId,
      _user_id: userId,
    });
    if (!canAccess) throw new Error("Projeto não encontrado");

    const { data: rows, error } = await supabase
      .from("project_collaborators")
      .select("id, user_id, role, created_at, profiles(email, full_name)")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return rows ?? [];
  });

export const inviteProjectCollaborator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InviteInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertProjectOwner(supabase, data.projectId, userId);

    const admin = getAdminSupabase();
    const { data: profile } = await admin
      .from("profiles")
      .select("id, email")
      .ilike("email", data.email.trim())
      .maybeSingle();
    if (!profile) throw new Error("Usuário não encontrado. Ele precisa criar uma conta no ForzaAI primeiro.");
    if (profile.id === userId) throw new Error("Você já é o dono deste projeto.");

    const { error } = await supabase.from("project_collaborators").upsert(
      {
        project_id: data.projectId,
        user_id: profile.id,
        role: data.role,
        invited_by: userId,
      },
      { onConflict: "project_id,user_id" },
    );
    if (error) throw error;
    return { ok: true };
  });

export const removeProjectCollaborator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RemoveInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertProjectOwner(supabase, data.projectId, userId);

    const { error } = await supabase
      .from("project_collaborators")
      .delete()
      .eq("project_id", data.projectId)
      .eq("id", data.collaboratorId);
    if (error) throw error;
    return { ok: true };
  });
