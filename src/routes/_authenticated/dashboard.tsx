import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sparkles,
  Globe,
  Trash2,
  ExternalLink,
  ArrowUp,
  MessageSquare,
  Wand2,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { deleteProject, deleteEmptyDrafts } from "@/lib/projects.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({ component: Dashboard });

function Dashboard() {
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [prompt, setPrompt] = useState("");
  const [launching, setLaunching] = useState(false);
  const deleteFn = useServerFn(deleteProject);
  const cleanupFn = useServerFn(deleteEmptyDrafts);

  const { data: projects, isLoading, error: projectsError } = useQuery({
    queryKey: ["projects"],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Auto-cleanup empty drafts on mount
  useEffect(() => {
    cleanupFn({})
      .then((res) => {
        if (res.deleted > 0) qc.invalidateQueries({ queryKey: ["projects"] });
      })
      .catch(() => {});
  }, [cleanupFn, qc]);

  const delMutation = useMutation({
    mutationFn: async (id: string) => deleteFn({ data: { projectId: id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      setConfirmDelete(null);
      toast.success("Projeto excluído");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleLaunchFromPrompt = async () => {
    const p = prompt.trim();
    if (p.length < 6) return toast.error("Descreva o site que você quer criar.");
    setLaunching(true);
    const guessedName = p.split(/[.,\n]/)[0].slice(0, 60) || "Novo site";
    const { data, error } = await supabase.rpc("create_user_project", {
      _name: guessedName,
      _site_type: "landing-page",
      _description: p,
    });
    if (error || !data) {
      setLaunching(false);
      toast.error(error?.message ?? "Não consegui criar o projeto");
      return;
    }
    try {
      sessionStorage.setItem(`initial-prompt:${data.id}`, p);
    } catch {}
    qc.invalidateQueries({ queryKey: ["projects"] });
    setPrompt("");
    router.navigate({ to: "/projects/$projectId", params: { projectId: data.id } });
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto overflow-x-clip">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs text-primary mb-3">
            <MessageSquare className="size-3.5" /> Dashboard inteligente
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold">Crie seu próximo projeto no chat</h1>
          <p className="text-muted-foreground mt-1">
            Descreva a ideia, responda o wizard e deixe a IA montar a primeira versão.
          </p>
        </div>
        <Button className="w-full sm:w-auto bg-gradient-primary shadow-glow" onClick={() => setOpen(true)}>
          Criar pelo chat
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crie pelo chat</DialogTitle>
            <DialogDescription>
              Escreva o que quer construir no campo principal do Dashboard. O ForzaAI fará perguntas obrigatórias antes de gerar.
            </DialogDescription>
          </DialogHeader>
          <Button onClick={() => setOpen(false)}>Entendi</Button>
        </DialogContent>
      </Dialog>

      <div className="mt-6 sm:mt-8 rounded-3xl sm:rounded-[2rem] border border-border bg-gradient-to-br from-card via-card to-primary/5 p-4 sm:p-5 md:p-8 shadow-elegant">
        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Sparkles className="size-3.5 text-primary" /> ForzaAI Studio
          </div>
          <h2 className="font-display text-2xl sm:text-3xl md:text-5xl font-semibold mt-3 tracking-tight">
            O que você quer construir hoje?
          </h2>
          <p className="text-muted-foreground mt-3 max-w-2xl mx-auto">
            Comece com uma frase. Depois disso, o ForzaAI prepara perguntas obrigatórias para evitar
            alucinação e criar um projeto com contexto real.
          </p>
        </div>

        <div className="mt-6 sm:mt-8 mx-auto max-w-4xl relative rounded-2xl sm:rounded-3xl border border-border bg-background/80 focus-within:border-primary/60 focus-within:shadow-glow transition">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!launching) handleLaunchFromPrompt();
              }
            }}
            placeholder="Ex: Quero criar um SaaS para clínicas gerenciarem agendamentos, pagamentos e WhatsApp…"
            rows={5}
            className="w-full resize-none bg-transparent px-4 sm:px-5 py-4 sm:py-5 pr-14 sm:pr-16 text-sm md:text-base outline-none placeholder:text-muted-foreground"
          />
          <Button
            size="icon"
            onClick={handleLaunchFromPrompt}
            disabled={launching || prompt.trim().length < 6}
            className="absolute bottom-3 right-3 sm:bottom-4 sm:right-4 size-10 rounded-2xl bg-gradient-primary shadow-glow"
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {[
            "Site institucional para clínica odontológica",
            "Landing page de SaaS com pricing",
            "Portfolio minimalista para designer",
            "E-commerce para loja de roupas",
          ].map((s) => (
            <button
              key={s}
              onClick={() => setPrompt(s)}
              className="text-xs px-3 py-1.5 rounded-full border border-border bg-background/70 hover:bg-muted/50 hover:border-primary/40 transition"
            >
              {s}
            </button>
          ))}
        </div>

        <div className="mt-8 grid gap-3 md:grid-cols-3">
          {[
            { icon: Wand2, title: "Wizard obrigatório", text: "Perguntas inteligentes após o primeiro prompt." },
            { icon: ShieldCheck, title: "Mais precisão", text: "Menos invenções, mais contexto real." },
            { icon: MessageSquare, title: "Chat central", text: "Criação começa direto na conversa." },
          ].map((item) => (
            <div key={item.title} className="rounded-2xl border border-border bg-background/50 p-4">
              <item.icon className="size-4 text-primary" />
              <h3 className="font-medium mt-2">{item.title}</h3>
              <p className="text-xs text-muted-foreground mt-1">{item.text}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8 sm:mt-10">
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
             <h2 className="font-display text-xl sm:text-2xl font-semibold">Projetos recentes</h2>
            <p className="text-sm text-muted-foreground">Continue editando ou publique seus sites.</p>
          </div>
        </div>
        {projectsError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            Não foi possível carregar projetos recentes. Rode o SQL atualizado para corrigir as regras do banco.
          </div>
        ) : isLoading ? (
          <div className="grid md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-40 rounded-xl border border-border bg-card animate-pulse" />
            ))}
          </div>
        ) : projects && projects.length > 0 ? (
          <div className="grid md:grid-cols-3 gap-4">
            {projects.map((p) => (
              <div
                key={p.id}
                className="group relative p-6 rounded-xl border border-border bg-card hover:border-primary/50 hover:shadow-elegant transition-all"
              >
                <Link to="/projects/$projectId" params={{ projectId: p.id }} className="block">
                  <div className="flex items-center justify-between">
                    <div className="size-10 rounded-lg bg-primary/10 grid place-items-center">
                      <Sparkles className="size-5 text-primary" />
                    </div>
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">
                      {p.status === "published"
                        ? "Publicado"
                        : p.status === "active"
                          ? "Ativo"
                          : "Rascunho"}
                    </span>
                  </div>
                  <h3 className="font-display font-semibold text-lg mt-4 truncate">{p.name}</h3>
                  <p className="text-xs text-muted-foreground mt-1">{p.site_type}</p>
                  {p.slug && (
                    <div className="mt-3 flex items-center gap-1 text-xs text-accent truncate">
                      <Globe className="size-3 shrink-0" /> /s/{p.slug}
                    </div>
                  )}
                </Link>
                <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {p.slug && (
                    <Button size="icon" variant="ghost" className="size-7" asChild>
                      <a
                        href={`/s/${p.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 text-destructive hover:text-destructive"
                    onClick={(e) => {
                      e.preventDefault();
                      setConfirmDelete({ id: p.id, name: p.name });
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
            <div className="size-12 rounded-full bg-primary/10 grid place-items-center mx-auto">
              <Sparkles className="size-6 text-primary" />
            </div>
            <h3 className="font-display text-xl font-semibold mt-4">Nenhum projeto ainda</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Crie o primeiro projeto usando o chat do Painel.
            </p>
          </div>
        )}
      </div>

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir projeto?</DialogTitle>
            <DialogDescription>
              Isso vai apagar permanentemente <strong>{confirmDelete?.name}</strong> e todos os
              arquivos/conversas. Não dá pra desfazer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmDelete && delMutation.mutate(confirmDelete.id)}
              disabled={delMutation.isPending}
            >
              {delMutation.isPending ? "Excluindo…" : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
