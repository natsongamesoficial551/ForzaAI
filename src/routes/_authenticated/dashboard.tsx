import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Sparkles, Globe, Trash2, ExternalLink, ArrowUp } from "lucide-react";
import { toast } from "sonner";
import { deleteProject, deleteEmptyDrafts } from "@/lib/projects.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({ component: Dashboard });

const SITE_TYPES = [
  { value: "landing-page", label: "Landing Page" },
  { value: "institutional", label: "Site Institucional" },
  { value: "portfolio", label: "Portfolio" },
  { value: "ecommerce", label: "E-commerce" },
  { value: "blog", label: "Blog" },
  { value: "restaurant", label: "Restaurante" },
  { value: "clinic", label: "Clínica / Saúde" },
  { value: "saas", label: "SaaS" },
];

function Dashboard() {
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [siteType, setSiteType] = useState("landing-page");
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [prompt, setPrompt] = useState("");
  const [launching, setLaunching] = useState(false);
  const deleteFn = useServerFn(deleteProject);
  const cleanupFn = useServerFn(deleteEmptyDrafts);

  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects"],
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

  const handleCreate = async () => {
    if (!name.trim()) return toast.error("Dê um nome ao projeto");
    setCreating(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("projects")
      .insert({ name: name.trim(), site_type: siteType, user_id: user!.id })
      .select()
      .single();
    setCreating(false);
    if (error || !data) {
      toast.error("Não consegui criar o projeto");
      return;
    }
    qc.invalidateQueries({ queryKey: ["projects"] });
    setOpen(false);
    setName("");
    router.navigate({ to: "/projects/$projectId", params: { projectId: data.id } });
  };

  const handleLaunchFromPrompt = async () => {
    const p = prompt.trim();
    if (p.length < 6) return toast.error("Descreva o site que você quer criar.");
    setLaunching(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const guessedName = p.split(/[.,\n]/)[0].slice(0, 60) || "Novo site";
    const { data, error } = await supabase
      .from("projects")
      .insert({ name: guessedName, site_type: "landing-page", user_id: user!.id, description: p })
      .select()
      .single();
    if (error || !data) {
      setLaunching(false);
      toast.error("Não consegui criar o projeto");
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
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Seus projetos</h1>
          <p className="text-muted-foreground mt-1">Crie sites incríveis em minutos com IA.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-gradient-primary shadow-glow">
              <Plus className="size-4" /> Novo projeto
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Novo projeto</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label>Nome do projeto</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Pizzaria Bella"
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label>Tipo de site</Label>
                <Select value={siteType} onValueChange={setSiteType}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SITE_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleCreate} disabled={creating} className="bg-gradient-primary">
                {creating ? "Criando…" : "Criar e abrir"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="mt-8 rounded-2xl border border-border bg-gradient-to-br from-card to-card/40 p-6 md:p-8 shadow-elegant">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <Sparkles className="size-3.5 text-primary" /> Comece com uma ideia
        </div>
        <h2 className="font-display text-2xl md:text-3xl font-semibold mt-2">
          O que você quer construir hoje?
        </h2>
        <div className="mt-5 relative rounded-xl border border-border bg-background/60 focus-within:border-primary/60 transition">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!launching) handleLaunchFromPrompt();
              }
            }}
            placeholder="Ex: Landing page para minha pizzaria com cardápio, depoimentos e WhatsApp…"
            rows={3}
            className="w-full resize-none bg-transparent px-4 py-3 pr-14 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Button
            size="icon"
            onClick={handleLaunchFromPrompt}
            disabled={launching || prompt.trim().length < 6}
            className="absolute bottom-2 right-2 size-9 bg-gradient-primary shadow-glow"
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            "Site institucional para clínica odontológica",
            "Landing page de SaaS com pricing",
            "Portfolio minimalista para designer",
            "E-commerce para loja de roupas",
          ].map((s) => (
            <button
              key={s}
              onClick={() => setPrompt(s)}
              className="text-xs px-3 py-1.5 rounded-full border border-border bg-card hover:bg-muted/50 hover:border-primary/40 transition"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-10">
        {isLoading ? (
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
              Clique em "Novo projeto" para começar.
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
