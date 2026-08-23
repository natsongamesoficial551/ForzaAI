import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "")
      .slice(0, 40) || "site"
  );
}

function randSuffix(n = 6) {
  return Math.random()
    .toString(36)
    .slice(2, 2 + n);
}

export const deleteEmptyDrafts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    // Drafts older than 2 minutes with zero files
    const { data: drafts } = await supabase
      .from("projects")
      .select("id, created_at, status")
      .eq("user_id", userId)
      .eq("status", "draft")
      .lt("created_at", new Date(Date.now() - 2 * 60_000).toISOString());

    if (!drafts || drafts.length === 0) return { deleted: 0 };

    const ids: string[] = [];
    for (const d of drafts) {
      const { count } = await supabase
        .from("project_files")
        .select("id", { count: "exact", head: true })
        .eq("project_id", d.id);
      if ((count ?? 0) === 0) ids.push(d.id);
    }
    if (ids.length === 0) return { deleted: 0 };

    // Cleanup dependents (RLS allows owner)
    const { data: convos } = await supabase
      .from("conversations")
      .select("id")
      .in("project_id", ids);
    const convoIds = (convos ?? []).map((c) => c.id);
    if (convoIds.length > 0) {
      await supabase.from("messages").delete().in("conversation_id", convoIds);
      await supabase.from("conversations").delete().in("id", convoIds);
    }
    await supabase.from("project_memory").delete().in("project_id", ids);
    await supabase.from("projects").delete().in("id", ids);
    return { deleted: ids.length };
  });

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Verify ownership
    const { data: proj } = await supabase
      .from("projects")
      .select("id")
      .eq("id", data.projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!proj) throw new Error("Projeto não encontrado");

    const { data: convos } = await supabase
      .from("conversations")
      .select("id")
      .eq("project_id", data.projectId);
    const convoIds = (convos ?? []).map((c) => c.id);
    if (convoIds.length > 0) {
      await supabase.from("messages").delete().in("conversation_id", convoIds);
      await supabase.from("conversations").delete().in("id", convoIds);
    }
    await supabase.from("project_files").delete().eq("project_id", data.projectId);
    await supabase.from("project_memory").delete().eq("project_id", data.projectId);
    await supabase.from("projects").delete().eq("id", data.projectId);
    return { ok: true };
  });

export const publishProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: project } = await supabase
      .from("projects")
      .select("id, name, slug")
      .eq("id", data.projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!project) throw new Error("Projeto não encontrado");

    const { count } = await supabase
      .from("project_files")
      .select("id", { count: "exact", head: true })
      .eq("project_id", data.projectId);
    if (!count || count === 0) throw new Error("Gere o site antes de publicar.");

    let slug = project.slug;
    if (!slug) {
      const base = slugify(project.name);
      for (let i = 0; i < 5; i++) {
        const candidate = i === 0 ? base : `${base}-${randSuffix(4)}`;
        const { data: clash } = await supabase
          .from("projects")
          .select("id")
          .eq("slug", candidate)
          .maybeSingle();
        if (!clash) {
          slug = candidate;
          break;
        }
      }
      if (!slug) slug = `${base}-${randSuffix(8)}`;
    }

    await supabase
      .from("projects")
      .update({
        slug,
        status: "published",
        published_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.projectId);

    return { slug };
  });

const VisualEditorFileSchema = z.object({
  path: z.enum(["index.html", "styles.css", "script.js"]),
  content: z.string().min(1).max(2_500_000),
});

export const saveVisualEditorFiles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        files: z.array(VisualEditorFileSchema).min(1).max(3),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: canEdit, error: permissionError } = await context.supabase.rpc(
      "can_edit_project",
      { _project_id: data.projectId, _user_id: context.userId },
    );
    if (permissionError || !canEdit) throw new Error("Sem permissão para editar este projeto.");

    for (const file of data.files) {
      const { error } = await context.supabase
        .from("project_files")
        .update({ content: file.content, updated_at: new Date().toISOString() })
        .eq("project_id", data.projectId)
        .eq("path", file.path);
      if (error) throw error;
    }

    return { filesUpdated: data.files.length };
  });
