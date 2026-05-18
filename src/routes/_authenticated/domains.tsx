import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Globe2, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDomain, listDomains, removeDomain } from "@/lib/domains.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/domains")({ component: Domains });

function Domains() {
  const qc = useQueryClient();
  const listDomainsFn = useServerFn(listDomains);
  const addDomainFn = useServerFn(addDomain);
  const removeDomainFn = useServerFn(removeDomain);
  const [projectId, setProjectId] = useState("");
  const [domain, setDomain] = useState("");

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id, name, slug").order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: domains } = useQuery({
    queryKey: ["domains"],
    queryFn: () => listDomainsFn(),
  });

  const addMutation = useMutation({
    mutationFn: async () => addDomainFn({ data: { projectId, domain } }),
    onSuccess: () => {
      setDomain("");
      qc.invalidateQueries({ queryKey: ["domains"] });
      toast.success("Domínio adicionado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => removeDomainFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["domains"] });
      toast.success("Domínio removido");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="rounded-3xl border border-border bg-card p-8 shadow-elegant">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs text-primary">
          <Globe2 className="size-3.5" /> Domínios
        </div>
        <h1 className="font-display text-3xl font-bold mt-4">Domínios e publicação</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl">
          Agora você pode preparar domínios externos e usar o slug público atual. Subdomínios reais
          como site.forzaai.com exigem domínio próprio e DNS wildcard configurados fora do Netlify free.
        </p>

        <div className="mt-6 grid md:grid-cols-[1fr_1fr_auto] gap-3">
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="rounded-md border border-border bg-background px-3 text-sm"
          >
            <option value="">Selecione um projeto</option>
            {(projects ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="meudominio.com.br" />
          <Button onClick={() => addMutation.mutate()} disabled={!projectId || !domain.trim() || addMutation.isPending}>
            {addMutation.isPending && <Loader2 className="size-4 animate-spin" />}
            Adicionar
          </Button>
        </div>
      </div>

      <div className="grid gap-4 mt-6">
        {(domains ?? []).map((item: any) => (
          <div key={item.id} className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-xl font-semibold">{item.domain}</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Projeto: {item.projects?.name ?? "—"} · Status: {item.status}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => removeMutation.mutate(item.id)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
            <div className="mt-4 grid md:grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border border-border p-3">
                <div className="font-medium">Publicação atual</div>
                <div className="text-muted-foreground mt-1">
                  {item.projects?.slug ? `/s/${item.projects.slug}` : "Publique o projeto para gerar o slug."}
                </div>
              </div>
              <div className="rounded-xl border border-border p-3">
                <div className="font-medium">TXT de verificação futura</div>
                <div className="text-muted-foreground mt-1 font-mono break-all">forzaai-verify={item.verification_token}</div>
              </div>
            </div>
          </div>
        ))}
        {(!domains || domains.length === 0) && (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">
            Nenhum domínio cadastrado ainda.
          </div>
        )}
      </div>
    </div>
  );
}
