import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { sendChatMessage } from "@/lib/chat.functions";
import { publishProject } from "@/lib/projects.functions";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  Send,
  Monitor,
  Tablet,
  Smartphone,
  RefreshCw,
  Code2,
  Eye,
  Sparkles,
  Loader2,
  ExternalLink,
  Globe,
  Copy,
  Rocket,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import Editor from "@monaco-editor/react";

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  component: Workspace,
});

function Workspace() {
  const { projectId } = Route.useParams();
  const [input, setInput] = useState("");
  const [viewport, setViewport] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [streaming, setStreaming] = useState<{ status: string; chars: number } | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [publishOpen, setPublishOpen] = useState(false);
  const qc = useQueryClient();
  const sendFn = useServerFn(sendChatMessage);
  const publishFn = useServerFn(publishProject);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("*").eq("id", projectId).single();
      return data;
    },
  });

  const { data: files } = useQuery({
    queryKey: ["files", projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from("project_files")
        .select("*")
        .eq("project_id", projectId)
        .order("path");
      return data ?? [];
    },
  });

  const { data: messages } = useQuery({
    queryKey: ["messages", projectId],
    queryFn: async () => {
      const { data: convo } = await supabase
        .from("conversations")
        .select("id")
        .eq("project_id", projectId)
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (!convo) return [];
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", convo.id)
        .order("created_at");
      return data ?? [];
    },
  });

  const sendMutation = useMutation({
    mutationFn: async (message: string) => {
      setStreaming({ status: "Pensando…", chars: 0 });
      const stream = await sendFn({ data: { projectId, message } });
      let result = { message: "", filesUpdated: 0 };
      for await (const chunk of stream) {
        if (chunk.type === "status") {
          setStreaming((s) => ({ status: chunk.text, chars: s?.chars ?? 0 }));
        } else if (chunk.type === "progress") {
          setStreaming((s) => ({ status: s?.status ?? "Gerando…", chars: chunk.chars }));
        } else if (chunk.type === "done") {
          result = { message: chunk.message, filesUpdated: chunk.filesUpdated };
        }
      }
      return result;
    },
    onSuccess: (res) => {
      setStreaming(null);
      qc.invalidateQueries({ queryKey: ["messages", projectId] });
      qc.invalidateQueries({ queryKey: ["files", projectId] });
      qc.invalidateQueries({ queryKey: ["profile"] });
      setPreviewKey((k) => k + 1);
      if (res.filesUpdated > 0) toast.success(`${res.filesUpdated} arquivo(s) atualizado(s)`);
    },
    onError: (e: Error) => {
      setStreaming(null);
      toast.error(e.message);
    },
  });

  const publishMutation = useMutation({
    mutationFn: async () => publishFn({ data: { projectId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      setPublishOpen(true);
      toast.success("Site publicado!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  // Auto-send initial prompt from dashboard hero input
  useEffect(() => {
    try {
      const key = `initial-prompt:${projectId}`;
      const p = sessionStorage.getItem(key);
      if (p && !sendMutation.isPending) {
        sessionStorage.removeItem(key);
        sendMutation.mutate(p);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || sendMutation.isPending) return;
    setInput("");
    sendMutation.mutate(text);
  };

  const currentFile = files?.find((f) => f.path === activeFile) ?? files?.[0];
  const html = files?.find((f) => f.path === "index.html")?.content ?? "";
  const css = files?.find((f) => f.path === "styles.css")?.content ?? "";
  const js = files?.find((f) => f.path === "script.js")?.content ?? "";

  const previewDoc = useMemo(() => {
    const hasDoc = /<!doctype html>/i.test(html) || /<html[\s>]/i.test(html);
    if (hasDoc) {
      let doc = html;
      if (css && !/<style/i.test(doc))
        doc = doc.replace(/<\/head>/i, `<style>${css}</style></head>`);
      if (js && !/<script/i.test(doc))
        doc = doc.replace(/<\/body>/i, `<script>${js}<\/script></body>`);
      return doc;
    }
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${html}<script>${js}<\/script></body></html>`;
  }, [html, css, js]);

  const widths = { desktop: "100%", tablet: "768px", mobile: "390px" };
  const publicUrl = project?.slug
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/s/${project.slug}`
    : null;
  const hasFiles = (files?.length ?? 0) > 0;

  return (
    <div className="h-screen flex flex-col">
      <header className="h-14 border-b border-border px-4 flex items-center gap-3 shrink-0 bg-card/50">
        <Link to="/dashboard">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="font-display font-semibold truncate">
            {project?.name ?? "Carregando…"}
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <span>{project?.site_type}</span>
            {project?.slug && (
              <span className="flex items-center gap-1 text-accent">
                <Globe className="size-3" /> publicado
              </span>
            )}
          </div>
        </div>
        {project?.slug && (
          <Button size="sm" variant="ghost" asChild>
            <a href={`/s/${project.slug}`} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" /> Ver site
            </a>
          </Button>
        )}
        <Button
          size="sm"
          className="bg-gradient-primary"
          onClick={() => (project?.slug ? setPublishOpen(true) : publishMutation.mutate())}
          disabled={!hasFiles || publishMutation.isPending}
        >
          {publishMutation.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Rocket className="size-3.5" />
          )}
          {project?.slug ? "Compartilhar" : "Publicar"}
        </Button>
      </header>

      <ResizablePanelGroup direction="horizontal" className="flex-1">
        <ResizablePanel defaultSize={32} minSize={22}>
          <div className="h-full flex flex-col bg-card/30">
            <div className="px-4 py-3 border-b border-border text-sm font-semibold flex items-center gap-2">
              <Sparkles className="size-4 text-primary" /> Chat com IA
            </div>
            <div ref={scrollRef} className="flex-1 overflow-auto p-4 space-y-3">
              {(!messages || messages.length === 0) && !streaming && (
                <div className="rounded-lg border border-border bg-card p-4 text-sm">
                  <p className="text-muted-foreground">
                    Olá! Me conte sobre o site que você quer. Vou te fazer perguntas para entender
                    seu negócio e gerar o site.
                  </p>
                </div>
              )}
              {messages?.map((m) => (
                <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
                  <div
                    className={`rounded-lg p-3 text-sm max-w-[90%] whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-card border border-border"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {streaming && (
                <div className="rounded-lg p-3 text-sm bg-card border border-border inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin text-primary" />
                  <span className="text-muted-foreground">
                    {streaming.status}
                    {streaming.chars > 0 && (
                      <span className="ml-2 text-xs">
                        ({streaming.chars.toLocaleString()} chars)
                      </span>
                    )}
                  </span>
                </div>
              )}
            </div>
            <div className="p-3 border-t border-border">
              <div className="relative">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Descreva o que você quer no site…"
                  className="resize-none min-h-[80px] pr-12"
                  disabled={sendMutation.isPending}
                />
                <Button
                  size="icon"
                  className="absolute right-2 bottom-2 size-8 bg-gradient-primary"
                  onClick={handleSend}
                  disabled={sendMutation.isPending || !input.trim()}
                >
                  {sendMutation.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Send className="size-3.5" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </ResizablePanel>
        <ResizableHandle />

        <ResizablePanel defaultSize={68}>
          <Tabs defaultValue="preview" className="h-full flex flex-col">
            <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-2">
              <TabsList className="bg-card">
                <TabsTrigger value="preview">
                  <Eye className="size-3.5 mr-1.5" />
                  Preview
                </TabsTrigger>
                <TabsTrigger value="code">
                  <Code2 className="size-3.5 mr-1.5" />
                  Código
                </TabsTrigger>
              </TabsList>
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant={viewport === "desktop" ? "default" : "ghost"}
                  onClick={() => setViewport("desktop")}
                  className="size-8"
                >
                  <Monitor className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant={viewport === "tablet" ? "default" : "ghost"}
                  onClick={() => setViewport("tablet")}
                  className="size-8"
                >
                  <Tablet className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant={viewport === "mobile" ? "default" : "ghost"}
                  onClick={() => setViewport("mobile")}
                  className="size-8"
                >
                  <Smartphone className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  onClick={() => setPreviewKey((k) => k + 1)}
                  title="Recarregar"
                >
                  <RefreshCw className="size-3.5" />
                </Button>
                {project?.slug && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    asChild
                    title="Abrir em nova aba"
                  >
                    <a href={`/s/${project.slug}`} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-3.5" />
                    </a>
                  </Button>
                )}
              </div>
            </div>

            <TabsContent value="preview" className="flex-1 m-0 bg-muted/30 p-4 overflow-auto">
              <div
                className="mx-auto h-full bg-background rounded-lg shadow-elegant overflow-hidden border border-border transition-all"
                style={{ width: widths[viewport], maxWidth: "100%" }}
              >
                {hasFiles ? (
                  <iframe
                    key={previewKey}
                    sandbox="allow-scripts allow-same-origin"
                    referrerPolicy="no-referrer"
                    srcDoc={previewDoc}
                    className="w-full h-full border-0"
                    title="Preview"
                  />
                ) : (
                  <div className="h-full grid place-items-center text-center p-8">
                    <div>
                      <div className="size-12 rounded-full bg-primary/10 grid place-items-center mx-auto">
                        <Sparkles className="size-6 text-primary" />
                      </div>
                      <p className="mt-4 font-display text-lg">Seu site aparecerá aqui</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Converse com a IA no painel ao lado.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="code" className="flex-1 m-0 flex">
              <div className="w-52 border-r border-border bg-card/30 p-2 overflow-auto shrink-0">
                <div className="text-xs uppercase tracking-wider text-muted-foreground px-2 py-1">
                  Arquivos
                </div>
                {files && files.length > 0 ? (
                  files.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setActiveFile(f.path)}
                      className={`w-full text-left px-2 py-1.5 rounded text-sm font-mono truncate ${currentFile?.path === f.path ? "bg-primary/20 text-foreground" : "text-muted-foreground hover:bg-card"}`}
                    >
                      {f.path}
                    </button>
                  ))
                ) : (
                  <div className="px-2 py-4 text-xs text-muted-foreground">Sem arquivos ainda.</div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                {currentFile ? (
                  <Editor
                    height="100%"
                    theme="vs-dark"
                    language={currentFile.language}
                    value={currentFile.content}
                    options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13 }}
                  />
                ) : (
                  <div className="h-full grid place-items-center text-muted-foreground text-sm">
                    Sem código para mostrar.
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </ResizablePanel>
      </ResizablePanelGroup>

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Site publicado 🚀</DialogTitle>
            <DialogDescription>
              Compartilhe o link abaixo. Toda nova geração já fica disponível na mesma URL.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 mt-2">
            <Input readOnly value={publicUrl ?? ""} className="font-mono text-sm" />
            <Button
              variant="outline"
              size="icon"
              onClick={async () => {
                if (publicUrl) {
                  await navigator.clipboard.writeText(publicUrl);
                  toast.success("Link copiado");
                }
              }}
            >
              <Copy className="size-4" />
            </Button>
            <Button asChild>
              <a href={publicUrl ?? "#"} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" /> Abrir
              </a>
            </Button>
          </div>
          <div className="flex justify-end mt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => publishMutation.mutate()}
              disabled={publishMutation.isPending}
            >
              {publishMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin mr-1" />
              ) : (
                <RefreshCw className="size-3.5 mr-1" />
              )}
              Republicar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
