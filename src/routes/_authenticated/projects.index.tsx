import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Globe, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/projects/")({ component: Projects });

function Projects() {
  const { data: projects, isLoading, error } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, site_type, status, slug, updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Projetos</h1>
          <p className="text-muted-foreground mt-1">
            Veja e abra os projetos criados. Para criar um novo, use o chat do Dashboard.
          </p>
        </div>
        <Button asChild className="bg-gradient-primary shadow-glow">
          <Link to="/dashboard">Criar pelo chat</Link>
        </Button>
      </div>

      {error && (
        <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Não foi possível carregar os projetos. Atualize o SQL do banco e tente novamente.
        </div>
      )}

      <div className="mt-8">
        {isLoading ? (
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
