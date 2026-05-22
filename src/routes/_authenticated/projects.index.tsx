import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Globe, Loader2, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/projects/")({ component: Projects });

function Projects() {
  const router = useRouter();
  const queryClient = useQueryClient();
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
    setLaunching(true);
    const projectName = `Novo projeto ${new Date().toLocaleDateString("pt-BR")}`;
    const { data, error } = await supabase.rpc("create_user_project", {
      _name: projectName,
      _site_type: "landing-page",
      _description: null,
    });
    setLaunching(false);
    if (error || !data) {
      toast.error(error?.message ?? "Não consegui criar o projeto");
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    router.navigate({ to: "/projects/$projectId", params: { projectId: data.id } });
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Projetos</h1>
          <p className="text-muted-foreground mt-1">
            Veja seus projetos e crie um workspace novo para conversar com a IA.
          </p>
        </div>
        <Button onClick={handleCreateProject} disabled={launching} className="bg-gradient-primary shadow-glow">
          {launching ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Criar projeto
        </Button>
      </div>

      <div className="mt-8 rounded-[2rem] border border-border bg-gradient-to-br from-card via-card to-primary/5 p-6 md:p-8 shadow-elegant flex flex-col md:flex-row md:items-center md:justify-between gap-5">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Sparkles className="size-3.5 text-primary" /> Novo workspace
          </div>
          <h2 className="font-display text-2xl md:text-4xl font-semibold mt-3 tracking-tight">
            Comece um projeto limpo
          </h2>
          <p className="text-sm text-muted-foreground mt-2">
            Crie o projeto agora e descreva o que quer construir no chat com preview, código e Build.
          </p>
        </div>
        <Button size="lg" onClick={handleCreateProject} disabled={launching} className="bg-gradient-primary shadow-glow shrink-0">
          {launching ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Criar projeto
        </Button>
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
            <p className="text-sm text-muted-foreground mt-1">Clique em Criar projeto para abrir um workspace novo.</p>
          </div>
        )}
      </div>
    </div>
  );
}
