import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowUp, ExternalLink, Globe, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/projects/")({ component: Projects });

function Projects() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [launching, setLaunching] = useState(false);

  const { data: projects, isLoading, error } = useQuery({
    queryKey: ["projects"],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, site_type, status, slug, updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const handleCreateProject = async () => {
    const p = prompt.trim();
    if (p.length < 6) return toast.error("Descreva o projeto que você quer criar.");
    setLaunching(true);
    const guessedName = p.split(/[.,\n]/)[0].slice(0, 60) || "Novo site";
    const { data, error } = await supabase.rpc("create_user_project", {
      _name: guessedName,
      _site_type: "landing-page",
      _description: p,
    });
    setLaunching(false);
    if (error || !data) {
      toast.error(error?.message ?? "Não consegui criar o projeto");
      return;
    }
    try {
      sessionStorage.setItem(`initial-prompt:${data.id}`, p);
    } catch {}
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    setPrompt("");
    router.navigate({ to: "/projects/$projectId", params: { projectId: data.id } });
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Projetos</h1>
          <p className="text-muted-foreground mt-1">
            Veja, abra ou crie um projeto do zero sem passar pelo Dashboard.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/dashboard">Ir para Dashboard</Link>
        </Button>
      </div>

      <div className="mt-8 rounded-[2rem] border border-border bg-gradient-to-br from-card via-card to-primary/5 p-5 md:p-8 shadow-elegant">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Sparkles className="size-3.5 text-primary" /> Novo projeto
          </div>
          <h2 className="font-display text-2xl md:text-4xl font-semibold mt-3 tracking-tight">
            Descreva o que quer construir
          </h2>
          <p className="text-sm text-muted-foreground mt-2">
            O ForzaAI cria o projeto, abre o workspace e inicia o Plan automaticamente.
          </p>
        </div>
        <div className="mt-6 relative rounded-3xl border border-border bg-background/80 focus-within:border-primary/60 focus-within:shadow-glow transition">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (!launching) handleCreateProject();
              }
            }}
            placeholder="Ex: Quero um site institucional moderno para uma clínica odontológica em São Paulo…"
            rows={4}
            className="w-full resize-none bg-transparent px-5 py-5 pr-16 text-sm md:text-base outline-none placeholder:text-muted-foreground"
          />
          <Button
            size="icon"
            onClick={handleCreateProject}
            disabled={launching || prompt.trim().length < 6}
            className="absolute bottom-4 right-4 size-10 rounded-2xl bg-gradient-primary shadow-glow"
          >
            {launching ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Não foi possível carregar os projetos por uma regra do banco. Rode o SQL atualizado e recarregue a página.
        </div>
      )}

      <div className="mt-8">
        {error ? null : isLoading ? (
          <div className="grid md:grid-cols-3 gap-4">
            {[1, 2, 3].map((item) => (
              <div key={item} className="h-40 rounded-xl border border-border bg-card animate-pulse" />
            ))}
          </div>
        ) : projects && projects.length > 0 ? (
          <div className="grid md:grid-cols-3 gap-4">
            {projects.map((project) => (
              <div
                key={project.id}
                className="group relative p-6 rounded-xl border border-border bg-card hover:border-primary/50 hover:shadow-elegant transition-all"
              >
                <Link to="/projects/$projectId" params={{ projectId: project.id }} className="block">
                  <div className="flex items-center justify-between">
                    <div className="size-10 rounded-lg bg-primary/10 grid place-items-center">
                      <Sparkles className="size-5 text-primary" />
                    </div>
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">
                      {project.status === "published" ? "Publicado" : project.status === "active" ? "Ativo" : "Rascunho"}
                    </span>
                  </div>
                  <h3 className="font-display font-semibold text-lg mt-4 truncate">{project.name}</h3>
                  <p className="text-xs text-muted-foreground mt-1">{project.site_type}</p>
                  {project.slug && (
                    <div className="mt-3 flex items-center gap-1 text-xs text-accent truncate">
                      <Globe className="size-3 shrink-0" /> /s/{project.slug}
                    </div>
                  )}
                </Link>
                {project.slug && (
                  <Button size="icon" variant="ghost" className="absolute top-3 right-3 size-7 opacity-0 group-hover:opacity-100" asChild>
                    <a href={`/s/${project.slug}`} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-3.5" />
                    </a>
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
            <div className="size-12 rounded-full bg-primary/10 grid place-items-center mx-auto">
              <Sparkles className="size-6 text-primary" />
            </div>
            <h3 className="font-display text-xl font-semibold mt-4">Nenhum projeto ainda</h3>
            <p className="text-sm text-muted-foreground mt-1">Crie o primeiro projeto usando o chat do Dashboard.</p>
          </div>
        )}
      </div>
    </div>
  );
}
