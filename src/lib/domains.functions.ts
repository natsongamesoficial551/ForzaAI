import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const DomainInputSchema = z.object({
  projectId: z.string().uuid(),
  domain: z.string().min(4).max(253),
});

const RemoveDomainSchema = z.object({ id: z.string().uuid() });

function normalizeDomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
}

export const listDomains = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("project_domains")
      .select("id, project_id, domain, status, verification_token, instructions, created_at, projects(name, slug)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const addDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DomainInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const domain = normalizeDomain(data.domain);
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw new Error("Domínio inválido.");

    const { data: project } = await supabase
      .from("projects")
      .select("id, user_id, slug")
      .eq("id", data.projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!project) throw new Error("Projeto não encontrado");

    const instructions = {
      cname: "Aponte um CNAME para o domínio atual da Netlify quando o domínio principal estiver configurado.",
      txt: "Crie um registro TXT com o token abaixo para verificação futura.",
      fallback: project.slug ? `/s/${project.slug}` : "Publique o projeto primeiro para liberar o slug público.",
    };

    const { error } = await supabase.from("project_domains").insert({
      project_id: data.projectId,
      user_id: userId,
      domain,
      instructions,
    });
    if (error) throw error;
    return { ok: true };
  });

export const removeDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RemoveDomainSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("project_domains")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });
