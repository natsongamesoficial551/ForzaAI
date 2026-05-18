import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SkillSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(300).default(""),
  prompt: z.string().min(10).max(3000),
  isActive: z.boolean().default(true),
});

const UpdateSkillSchema = SkillSchema.extend({ id: z.string().uuid() });

const ToggleProjectSkillSchema = z.object({
  projectId: z.string().uuid(),
  skillId: z.string().uuid(),
  active: z.boolean(),
});

export const listSkills = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("ai_skills")
      .select("id, user_id, name, description, prompt, is_global, is_active, created_at")
      .order("is_global", { ascending: false })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data ?? [];
  });

export const createSkill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SkillSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("ai_skills").insert({
      user_id: userId,
      name: data.name,
      description: data.description,
      prompt: data.prompt,
      is_active: data.isActive,
      is_global: false,
    });
    if (error) throw error;
    return { ok: true };
  });

export const updateSkill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateSkillSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("ai_skills")
      .update({
        name: data.name,
        description: data.description,
        prompt: data.prompt,
        is_active: data.isActive,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const toggleProjectSkill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ToggleProjectSkillSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: canEdit } = await supabase.rpc("can_edit_project", {
      _project_id: data.projectId,
      _user_id: userId,
    });
    if (!canEdit) throw new Error("Projeto não encontrado");

    if (!data.active) {
      const { error } = await supabase
        .from("project_skill_activations")
        .delete()
        .eq("project_id", data.projectId)
        .eq("skill_id", data.skillId);
      if (error) throw error;
      return { ok: true };
    }

    const { error } = await supabase.from("project_skill_activations").upsert(
      {
        project_id: data.projectId,
        skill_id: data.skillId,
        user_id: userId,
      },
      { onConflict: "project_id,skill_id" },
    );
    if (error) throw error;
    return { ok: true };
  });
