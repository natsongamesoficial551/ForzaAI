import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import JSZip from "jszip";
import html2canvas from "html2canvas";
import { generateProjectWizard, getGenerationJob, listProjectFileVersions, revertProjectFileVersion, sendChatMessage, startGenerationJob } from "@/lib/chat.functions";
import { publishProject } from "@/lib/projects.functions";
import {
  inviteProjectCollaborator,
  listProjectCollaborators,
  removeProjectCollaborator,
} from "@/lib/collaboration.functions";
import { listSkills, toggleProjectSkill } from "@/lib/skills.functions";
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
  Paperclip,
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
  CheckCircle2,
  Users,
  X,
  Brain,
  Hammer,
  Lock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { notifyGenerationComplete, playInterfaceSound } from "@/lib/client-feedback";
import Editor from "@monaco-editor/react";

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  component: Workspace,
});

type WizardQuestion = {
  id: string;
  question: string;
  options: string[];
};

type ForzaModelId = "forza-1-flash" | "forza-1-pro" | "forza-2-pro" | "forza-2-5-thinking";

type ChatAttachment = {
  name: string;
  type?: string;
  size: number;
  kind: "image" | "zip" | "text" | "file";
  content: string;
};

type EngineTask = {
  id: string;
  position: number;
  phase: string;
  title: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed";
  error?: string | null;
};

type ProjectFileVersion = {
  id: string;
  version_number: number;
  label: string;
  summary?: string | null;
  created_at: string;
};

const textLikeExtensions = new Set(["html", "css", "js", "ts", "tsx", "jsx", "json", "md", "txt", "csv", "xml", "svg", "yml", "yaml", "sql", "py"]);

function readableError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(raw) as { errorMessage?: string; message?: string; error?: string };
    return parsed.errorMessage || parsed.message || parsed.error || raw;
  } catch {
    return raw;
  }
}

const modelOptions: Array<{ id: ForzaModelId; label: string; description: string; requiresSubscription: boolean }> = [
  { id: "forza-1-flash", label: "Forza 1.0 Flash", description: "Rápido e econômico", requiresSubscription: false },
  { id: "forza-1-pro", label: "Forza 1.0 Pro", description: "Mais qualidade no plano free", requiresSubscription: false },
  { id: "forza-2-pro", label: "Forza 2.0 Pro", description: "Modelo Pro para assinantes", requiresSubscription: true },
  { id: "forza-2-5-thinking", label: "Forza 2.5 Thinking", description: "Raciocínio avançado", requiresSubscription: true },
];

function Workspace() {
  const { projectId } = Route.useParams();
  const [input, setInput] = useState("");
  const [viewport, setViewport] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [streaming, setStreaming] = useState<{ status: string; chars: number } | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [publishOpen, setPublishOpen] = useState(false);
  const [collabOpen, setCollabOpen] = useState(false);
  const [collabEmail, setCollabEmail] = useState("");
  const [collabRole, setCollabRole] = useState<"viewer" | "editor">("editor");
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [initialPrompt, setInitialPrompt] = useState("");
  const [wizardPrompt, setWizardPrompt] = useState("");
  const [wizardQuestions, setWizardQuestions] = useState<WizardQuestion[]>([]);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardAnswers, setWizardAnswers] = useState<Record<string, string>>({});
  const [wizardCustomAnswers, setWizardCustomAnswers] = useState<Record<string, string>>({});
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [readingAttachments, setReadingAttachments] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ForzaModelId>("forza-1-flash");
  const [modelOpen, setModelOpen] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const completedJobRef = useRef<string | null>(null);
  const qc = useQueryClient();
  const wizardFn = useServerFn(generateProjectWizard);
  const sendFn = useServerFn(sendChatMessage);
  const startJobFn = useServerFn(startGenerationJob);
  const getJobFn = useServerFn(getGenerationJob);
  const listVersionsFn = useServerFn(listProjectFileVersions);
  const revertVersionFn = useServerFn(revertProjectFileVersion);
  const publishFn = useServerFn(publishProject);
  const listCollaboratorsFn = useServerFn(listProjectCollaborators);
  const inviteCollaboratorFn = useServerFn(inviteProjectCollaborator);
  const removeCollaboratorFn = useServerFn(removeProjectCollaborator);
  const listSkillsFn = useServerFn(listSkills);
  const toggleProjectSkillFn = useServerFn(toggleProjectSkill);
  const scrollRef = useRef<HTMLDivElement>(null);
  const previewFrameRef = useRef<HTMLIFrameElement>(null);

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

  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("sound_enabled").single();
      return data;
    },
  });

  const { data: hasSubscription } = useQuery({
    queryKey: ["has-active-subscription"],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("has_active_subscription");
      if (error) return false;
      return !!data;
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

  const { data: collaborators } = useQuery({
    queryKey: ["collaborators", projectId],
    queryFn: () => listCollaboratorsFn({ data: { projectId } }),
  });

  const { data: skills } = useQuery({
    queryKey: ["skills"],
    queryFn: () => listSkillsFn(),
  });

  const { data: activeSkills } = useQuery({
    queryKey: ["project-skills", projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from("project_skill_activations")
        .select("skill_id")
        .eq("project_id", projectId);
      return new Set((data ?? []).map((item) => item.skill_id));
    },
  });

  const wizardMutation = useMutation({
    mutationFn: async (prompt: string) => wizardFn({ data: { projectId, prompt, modelId: selectedModel } }),
    onSuccess: (wizard, prompt) => {
      if (!wizard.shouldAsk || wizard.questions.length === 0) {
        toast.error("O Plan não conseguiu montar perguntas. Tente descrever o site com mais detalhes.");
        return;
      }
      setWizardPrompt(prompt);
      setWizardQuestions(wizard.questions);
      setWizardStep(0);
      setWizardAnswers({});
      setWizardCustomAnswers({});
      toast.info("Responda o wizard para melhorar a geração.");
    },
    onError: (e: Error) => toast.error(readableError(e)),
  });

  const startBuildJob = (message: string, persistUserMessage = false) => {
    generationJobMutation.mutate({ message, persistUserMessage });
  };

  const generationJobMutation = useMutation({
    mutationFn: async ({ message, persistUserMessage }: { message: string; persistUserMessage?: boolean }) => {
      setStreaming({ status: "Enviando geração para background…", chars: 0 });
      return startJobFn({ data: { projectId, message, modelId: selectedModel, persistUserMessage } });
    },
    onSuccess: (job) => {
      completedJobRef.current = null;
      setActiveJobId(job.id);
      setStreaming({ status: job.stage ?? "Na fila para gerar…", chars: 0 });
      toast.info("Geração iniciada em background.");
    },
    onError: (e: Error) => {
      setStreaming(null);
      toast.error(readableError(e));
    },
  });

  const { data: activeJob } = useQuery({
    queryKey: ["generation-job", activeJobId],
    enabled: !!activeJobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "completed" || status === "failed" ? false : 2500;
    },
    queryFn: () => getJobFn({ data: { jobId: activeJobId! } }),
  });

  const { data: versions } = useQuery({
    queryKey: ["file-versions", projectId],
    queryFn: () => listVersionsFn({ data: { projectId } }),
  });

  const engineRun = activeJob?.engineRun;
  const engineTasks = (engineRun?.tasks ?? []) as EngineTask[];
  const validationArtifact = engineRun?.artifacts?.find((artifact: any) => artifact.kind === "validation_report");
  const validationReport = validationArtifact?.content as { score?: number; summary?: string } | undefined;

  useEffect(() => {
    if (!activeJob) return;
    setStreaming(activeJob.status === "completed" || activeJob.status === "failed" ? null : { status: activeJob.stage, chars: 0 });

    if (activeJob.status === "completed" && completedJobRef.current !== activeJob.id) {
      completedJobRef.current = activeJob.id;
      setActiveJobId(null);
      qc.invalidateQueries({ queryKey: ["messages", projectId] });
      qc.invalidateQueries({ queryKey: ["files", projectId] });
      qc.invalidateQueries({ queryKey: ["file-versions", projectId] });
      qc.invalidateQueries({ queryKey: ["profile"] });
      setPreviewKey((k) => k + 1);
      toast.success(`${activeJob.files_updated || 3} arquivo(s) atualizado(s)`);
      notifyGenerationComplete(profile?.sound_enabled ?? true);
    }

    if (activeJob.status === "failed" && completedJobRef.current !== activeJob.id) {
      completedJobRef.current = activeJob.id;
      setActiveJobId(null);
      toast.error(activeJob.error || "A geração falhou em background.");
    }
  }, [activeJob, projectId, profile?.sound_enabled, qc]);

  const sendMutation = useMutation({
    mutationFn: async ({
      message,
      attachments: messageAttachments,
      previewSnapshot,
    }: {
      message: string;
      attachments?: ChatAttachment[];
      previewSnapshot?: { viewport: "desktop" | "tablet" | "mobile"; html: string };
    }) => {
      setStreaming({ status: "Pensando…", chars: 0 });
      const timeout = new Promise<never>((_, reject) => {
        window.setTimeout(
          () => reject(new Error("A geração demorou demais. A hospedagem pode encerrar requests muito longas; tente novamente ou escolha um modelo mais rápido.")),
          260_000,
        );
      });
      const request = async () => {
        let stream;
        try {
          stream = await sendFn({ data: { projectId, message, modelId: selectedModel, attachments: messageAttachments, previewSnapshot } });
        } catch (error) {
          const raw = readableError(error);
          if (/502|Bad Gateway/i.test(raw)) {
            throw new Error("O provedor/modelo retornou gateway ou instabilidade. Tente novamente; se repetir, use um modelo menor no Admin.");
          }
          if (/unknown error|errorType/i.test(raw)) {
            throw new Error(`A geração falhou sem detalhe do servidor. Detalhe bruto: ${raw}`);
          }
          throw new Error(raw);
        }
        let result = { message: "", filesUpdated: 0 };
        for await (const chunk of stream) {
          if (chunk.type === "status") {
            setStreaming((s) => ({ status: chunk.text, chars: s?.chars ?? 0 }));
          } else if (chunk.type === "progress") {
            setStreaming((s) => ({ status: s?.status ?? "Gerando…", chars: chunk.chars }));
          } else if (chunk.type === "done") {
            result = { message: chunk.message, filesUpdated: chunk.filesUpdated };
            setStreaming(null);
          }
        }
        return result;
      };
      return Promise.race([request(), timeout]);
    },
    onSuccess: (res) => {
      setStreaming(null);
      qc.invalidateQueries({ queryKey: ["messages", projectId] });
      qc.invalidateQueries({ queryKey: ["files", projectId] });
      qc.invalidateQueries({ queryKey: ["file-versions", projectId] });
      qc.invalidateQueries({ queryKey: ["profile"] });
      setPreviewKey((k) => k + 1);
      if (res.filesUpdated > 0) {
        toast.success(`${res.filesUpdated} arquivo(s) atualizado(s)`);
        notifyGenerationComplete(profile?.sound_enabled ?? true);
      }
    },
    onError: (e: Error) => {
      setStreaming(null);
      toast.error(readableError(e));
    },
  });

  const revertVersionMutation = useMutation({
    mutationFn: async (versionId: string) => revertVersionFn({ data: { projectId, versionId } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["files", projectId] });
      qc.invalidateQueries({ queryKey: ["file-versions", projectId] });
      setPreviewKey((k) => k + 1);
      toast.success(`${res.filesUpdated} arquivo(s) restaurado(s)`);
    },
    onError: (e: Error) => toast.error(readableError(e)),
  });

  const publishMutation = useMutation({
    mutationFn: async () => publishFn({ data: { projectId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      setPublishOpen(true);
      toast.success("Site publicado!");
    },
    onError: (e: Error) => toast.error(readableError(e)),
  });

  const inviteMutation = useMutation({
    mutationFn: async () =>
      inviteCollaboratorFn({ data: { projectId, email: collabEmail, role: collabRole } }),
    onSuccess: () => {
      setCollabEmail("");
      qc.invalidateQueries({ queryKey: ["collaborators", projectId] });
      toast.success("Colaborador adicionado");
    },
    onError: (e: Error) => toast.error(readableError(e)),
  });

  const removeCollaboratorMutation = useMutation({
    mutationFn: async (collaboratorId: string) =>
      removeCollaboratorFn({ data: { projectId, collaboratorId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collaborators", projectId] });
      toast.success("Colaborador removido");
    },
    onError: (e: Error) => toast.error(readableError(e)),
  });

  const toggleSkillMutation = useMutation({
    mutationFn: async ({ skillId, active }: { skillId: string; active: boolean }) =>
      toggleProjectSkillFn({ data: { projectId, skillId, active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-skills", projectId] }),
    onError: (e: Error) => toast.error(readableError(e)),
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming, wizardQuestions, initialPrompt]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`project-model:${projectId}`) as ForzaModelId | null;
      if (saved && modelOptions.some((model) => model.id === saved)) setSelectedModel(saved);
    } catch {}
  }, [projectId]);

  const updateSelectedModel = (modelId: ForzaModelId) => {
    const option = modelOptions.find((model) => model.id === modelId);
    if (option?.requiresSubscription && !hasSubscription) {
      toast.info("Esse modelo é exclusivo para assinantes Pro.");
      return;
    }
    setSelectedModel(modelId);
    try {
      localStorage.setItem(`project-model:${projectId}`, modelId);
    } catch {}
  };

  // Auto-send initial prompt from dashboard hero input
  useEffect(() => {
    try {
      const key = `initial-prompt:${projectId}`;
      const p = sessionStorage.getItem(key);
      if (p && !sendMutation.isPending && !wizardMutation.isPending) {
        sessionStorage.removeItem(key);
        setInitialPrompt(p);
        wizardMutation.mutate(p);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const hasFiles = (files?.length ?? 0) > 0;
  const selectedModelOption = modelOptions.find((model) => model.id === selectedModel) ?? modelOptions[0];
  const isGenerating = generationJobMutation.isPending || !!activeJobId;
  const isPlanning = !isGenerating && !hasFiles && (wizardQuestions.length > 0 || !!initialPrompt || (!messages || messages.length === 0));
  const mode = isPlanning ? "plan" : "build";

  const handleSend = () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || sendMutation.isPending || generationJobMutation.isPending || !!activeJobId || wizardMutation.isPending || readingAttachments) return;
    playInterfaceSound("click", profile?.sound_enabled ?? true);
    const messageAttachments = attachments;
    setInput("");
    setAttachments([]);
    if (!hasFiles && (!messages || messages.length === 0) && messageAttachments.length === 0) {
      setInitialPrompt(text);
      wizardMutation.mutate(text);
      return;
    }
    if (messageAttachments.length === 0) {
      startBuildJob(`Pedido de ajuste do usuário:\n${text}\n\nModo Build: atualize os arquivos existentes mantendo o site funcional e aplicando exatamente o ajuste pedido. Se o pedido mencionar claro/escuro, tema, toggle ou modo noturno, implemente CSS dos dois temas e JavaScript real para alternar e persistir a preferência.`, true);
      return;
    }
    sendMutation.mutate({ message: text || "Analise os anexos enviados e sugira/corrija o site.", attachments: messageAttachments });
  };

  const readAttachment = async (file: File): Promise<ChatAttachment> => {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const kind: ChatAttachment["kind"] = file.type.startsWith("image/")
      ? "image"
      : extension === "zip"
        ? "zip"
        : textLikeExtensions.has(extension) || file.type.startsWith("text/")
          ? "text"
          : "file";

    if (kind === "zip") {
      const zip = await JSZip.loadAsync(file);
      const entries = Object.values(zip.files).filter((entry) => !entry.dir).slice(0, 80);
      const projectFiles = entries.filter((entry) => {
        const cleanName = entry.name.split("/").pop() ?? entry.name;
        const ext = cleanName.split(".").pop()?.toLowerCase() ?? "";
        return textLikeExtensions.has(ext);
      });
      const extracted = await Promise.all(
        projectFiles.slice(0, 30).map(async (entry) => {
          const content = await entry.async("string");
          return `--- ${entry.name} ---\n${content.slice(0, 16_000)}`;
        }),
      );
      return {
        name: file.name,
        type: file.type || extension,
        size: file.size,
        kind,
        content: [`ZIP extraído: ${entries.length} arquivo(s).`, ...extracted].join("\n\n").slice(0, 120_000),
      };
    }

    return new Promise<ChatAttachment>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`Não consegui ler ${file.name}`));
      reader.onload = () => {
        const raw = String(reader.result ?? "");
        resolve({
          name: file.name,
          type: file.type || extension,
          size: file.size,
          kind,
          content: kind === "image" ? raw : raw.slice(0, 120_000),
        });
      };
      if (kind === "image") reader.readAsDataURL(file);
      else reader.readAsText(file);
    });
  };

  const handleAttachmentChange = async (filesList: FileList | null) => {
    const selected = Array.from(filesList ?? []).slice(0, 6 - attachments.length);
    if (selected.length === 0) return;
    const oversized = selected.find((file) => file.size > 8_000_000);
    if (oversized) {
      toast.error(`${oversized.name} excede 8 MB.`);
      return;
    }
    setReadingAttachments(true);
    try {
      const loaded = await Promise.all(selected.map(readAttachment));
      setAttachments((current) => [...current, ...loaded].slice(0, 6));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não consegui anexar o arquivo.");
    } finally {
      setReadingAttachments(false);
    }
  };

  const handleReviewPreview = async () => {
    if (!hasFiles) return toast.error("Gere o site antes de pedir revisão visual.");
    const iframeDoc = previewFrameRef.current?.contentDocument;
    const target = iframeDoc?.documentElement;
    let screenshot: ChatAttachment | undefined;

    if (target) {
      try {
        const canvas = await html2canvas(target, {
          backgroundColor: iframeDoc.body ? getComputedStyle(iframeDoc.body).backgroundColor : "#ffffff",
          height: Math.min(target.scrollHeight, 2400),
          useCORS: true,
          width: target.clientWidth,
          windowHeight: Math.min(target.scrollHeight, 2400),
          windowWidth: target.clientWidth,
        });
        screenshot = {
          name: `preview-${viewport}.png`,
          type: "image/png",
          size: 0,
          kind: "image",
          content: canvas.toDataURL("image/png"),
        };
      } catch {
        toast.info("Não consegui capturar imagem do preview; vou analisar o HTML renderizado.");
      }
    }

    sendMutation.mutate({
      message: "Faça uma revisão visual automática do preview atual. Analise a captura de tela enviada e encontre problemas de layout, responsividade, contraste, hierarquia visual e acessibilidade. Se houver erro visual, corrija os arquivos completos.",
      attachments: screenshot ? [screenshot] : undefined,
      previewSnapshot: { viewport, html: previewDoc },
    });
  };

  const isCustomWizardOption = (value: string | undefined) =>
    !!value && /^(outros?|outra|personalizado|personalizada)/i.test(value.trim());

  const wizardAnswerValue = (question: WizardQuestion) => {
    const answer = wizardAnswers[question.id];
    if (!isCustomWizardOption(answer)) return answer?.trim() ?? "";
    return wizardCustomAnswers[question.id]?.trim() ?? "";
  };

  const clearWizard = () => {
    setWizardQuestions([]);
    setWizardStep(0);
    setWizardAnswers({});
    setWizardCustomAnswers({});
  };

  const currentWizardQuestion = wizardQuestions[wizardStep];

  const handleWizardNext = () => {
    if (!currentWizardQuestion) return;
    if (!wizardAnswerValue(currentWizardQuestion)) {
      toast.error("Responda essa pergunta para continuar.");
      return;
    }
    if (wizardStep < wizardQuestions.length - 1) {
      setWizardStep((step) => step + 1);
      return;
    }
    handleWizardSubmit();
  };

  const handleWizardSubmit = () => {
    if (wizardQuestions.some((question) => !wizardAnswerValue(question))) {
      toast.error("Responda todas as perguntas obrigatórias.");
      return;
    }

    const context = wizardQuestions
      .map((question, index) => `${index + 1}. ${question.question}\nResposta: ${wizardAnswerValue(question)}`)
      .join("\n\n");

    clearWizard();
    startBuildJob(`Prompt inicial do cliente:\n${wizardPrompt}\n\nPlan aprovado pelo cliente:\n${context}\n\nModo Build: gere agora os arquivos completos do site com base no prompt inicial e nas respostas acima.`);
  };

  const currentFile = files?.find((f) => f.path === activeFile) ?? files?.[0];
  const html = files?.find((f) => f.path === "index.html")?.content ?? "";
  const css = files?.find((f) => f.path === "styles.css")?.content ?? "";
  const js = files?.find((f) => f.path === "script.js")?.content ?? "";

  const previewDoc = useMemo(() => {
    const hasDoc = /<!doctype html>/i.test(html) || /<html[\s>]/i.test(html);
    const previewGuard = `<script>
document.addEventListener('click', function(event) {
  const link = event.target.closest('a[href]');
  if (!link) return;
  const href = link.getAttribute('href') || '';
  if (href.startsWith('#')) {
    event.preventDefault();
    document.querySelector(href)?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  if (!href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
    event.preventDefault();
  }
});
<\/script>`;
    if (hasDoc) {
      let doc = html;
      if (!/<base\b/i.test(doc)) doc = doc.replace(/<head>/i, `<head><base href="about:srcdoc">`);
      if (css && !/<style/i.test(doc))
        doc = doc.replace(/<\/head>/i, `<style>${css}</style></head>`);
      const inlineScript = js ? `<script>${js}<\/script>` : "";
      doc = doc.replace(/<script\b[^>]*src=["'][^"']*script\.js[^"']*["'][^>]*>\s*<\/script>/gi, "");
      if (inlineScript)
        doc = doc.replace(/<\/body>/i, `${inlineScript}</body>`);
      return doc.replace(/<\/body>/i, `${previewGuard}</body>`);
    }
    return `<!doctype html><html><head><base href="about:srcdoc"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${html}<script>${js}<\/script>${previewGuard}</body></html>`;
  }, [html, css, js]);

  const widths = { desktop: "100%", tablet: "768px", mobile: "390px" };
  const publicUrl = project?.slug
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/s/${project.slug}`
    : null;

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
        <Button size="sm" variant="outline" onClick={() => setModelOpen(true)}>
          <Brain className="size-3.5" /> {selectedModelOption.label}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setSkillsOpen(true)}>
          <Sparkles className="size-3.5" /> Skills
        </Button>
        <Button size="sm" variant="outline" onClick={() => setCollabOpen(true)}>
          <Users className="size-3.5" /> Colaborar
        </Button>
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
            <div className="px-4 py-3 border-b border-border text-sm font-semibold flex items-center justify-between gap-2">
              <span className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /> Chat com IA</span>
              <div className="flex rounded-full border border-border bg-background/60 p-0.5 text-[11px]">
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 ${mode === "plan" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                  <Brain className="size-3" /> Plan
                </span>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 ${mode === "build" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                  <Hammer className="size-3" /> Build
                </span>
              </div>
            </div>
            <div ref={scrollRef} className="flex-1 overflow-auto p-4 space-y-3">
              {initialPrompt && (
                <div className="rounded-lg border border-primary/30 bg-primary/10 p-4 text-sm">
                  <div className="text-xs font-semibold text-primary mb-2">Prompt inicial</div>
                  <p className="whitespace-pre-wrap">{initialPrompt}</p>
                </div>
              )}
              {(!messages || messages.length === 0) && !streaming && !initialPrompt && (
                <div className="rounded-lg border border-border bg-card p-4 text-sm">
                  <p className="text-muted-foreground">
                    Comece com o prompt inicial do site. Depois disso, entro em Plan para fazer perguntas obrigatórias e só gero no Build.
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
              {engineRun && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold flex items-center gap-2">
                        <Brain className="size-4 text-primary" /> Forza Engine
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Fase: {engineRun.phase} · Status: {engineRun.status}
                      </div>
                    </div>
                    {validationReport?.score !== undefined && (
                      <div className="rounded-full bg-background px-3 py-1 text-xs font-medium border border-border">
                        Score {validationReport.score}/100
                      </div>
                    )}
                  </div>
                  {engineTasks.length > 0 && (
                    <div className="space-y-2">
                      {engineTasks.map((task) => (
                        <div key={task.id} className="rounded-lg border border-border bg-background/70 p-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-xs font-medium truncate">{task.position}. {task.title}</div>
                              <div className="text-[11px] text-muted-foreground line-clamp-2">{task.description}</div>
                            </div>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${
                              task.status === "completed"
                                ? "bg-green-500/10 text-green-700"
                                : task.status === "running"
                                  ? "bg-primary/10 text-primary"
                                  : task.status === "failed"
                                    ? "bg-destructive/10 text-destructive"
                                    : "bg-muted text-muted-foreground"
                            }`}>
                              {task.status === "completed" ? "concluída" : task.status === "running" ? "rodando" : task.status === "failed" ? "falhou" : "pendente"}
                            </span>
                          </div>
                          {task.error && <div className="text-[11px] text-destructive mt-1">{task.error}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  {validationReport?.summary && (
                    <div className="rounded-lg bg-background/70 border border-border p-2 text-xs text-muted-foreground">
                      {validationReport.summary}
                    </div>
                  )}
                </div>
              )}
            </div>
            {currentWizardQuestion && (
              <div className="border-t border-border bg-background/70 p-3">
                <div className="rounded-2xl border border-primary/25 bg-card p-4 shadow-glow space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <CheckCircle2 className="size-4 text-primary" /> Plan inteligente
                    </div>
                    <span className="rounded-full border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground">
                      Pergunta {wizardStep + 1} de {wizardQuestions.length}
                    </span>
                  </div>
                  <div className="text-sm font-medium leading-relaxed">
                    {currentWizardQuestion.question}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {currentWizardQuestion.options.slice(0, 5).map((option) => {
                      const selected = wizardAnswers[currentWizardQuestion.id] === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setWizardAnswers((current) => ({ ...current, [currentWizardQuestion.id]: option }))}
                          className={`rounded-xl border px-3 py-2 text-left text-xs transition ${
                            selected
                              ? "border-primary bg-primary/15 text-foreground shadow-sm"
                              : "border-border bg-background/70 text-muted-foreground hover:border-primary/50 hover:text-foreground"
                          }`}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                  <Textarea
                    value={wizardCustomAnswers[currentWizardQuestion.id] ?? ""}
                    onFocus={() => setWizardAnswers((current) => ({ ...current, [currentWizardQuestion.id]: "Outro / personalizado" }))}
                    onChange={(event) => {
                      setWizardAnswers((current) => ({ ...current, [currentWizardQuestion.id]: "Outro / personalizado" }));
                      setWizardCustomAnswers((current) => ({ ...current, [currentWizardQuestion.id]: event.target.value }));
                    }}
                    placeholder="Ou escreva uma resposta personalizada para esta pergunta..."
                    className="min-h-16 resize-none text-xs"
                  />
                  <Button
                    className="w-full bg-gradient-primary shadow-glow"
                    onClick={handleWizardNext}
                    disabled={sendMutation.isPending || generationJobMutation.isPending || !!activeJobId}
                  >
                    {wizardStep === wizardQuestions.length - 1 ? (
                      <><Hammer className="size-4" /> Gerar site</>
                    ) : (
                      <>Próxima</>
                    )}
                  </Button>
                </div>
              </div>
            )}
            <div className="p-3 border-t border-border">
              {attachments.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {attachments.map((attachment, index) => (
                    <span key={`${attachment.name}-${index}`} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
                      <Paperclip className="size-3" /> {attachment.name}
                      <button type="button" onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))} className="ml-1 text-foreground hover:text-destructive">
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
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
                  placeholder={
                    wizardQuestions.length > 0
                      ? "Responda o Plan obrigatório acima para liberar o Build…"
                      : !hasFiles && (!messages || messages.length === 0) && !initialPrompt
                        ? "Descreva o site que deseja criar…"
                        : "Peça ajustes, envie prints de erro, imagens de referência, arquivos ou ZIP…"
                  }
                  className="resize-none min-h-[80px] pl-12 pr-12"
                  disabled={sendMutation.isPending || generationJobMutation.isPending || !!activeJobId || wizardMutation.isPending || wizardQuestions.length > 0}
                />
                <label className="absolute left-2 bottom-2 grid size-8 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
                  {readingAttachments ? <Loader2 className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5" />}
                  <input
                    type="file"
                    multiple
                    accept="image/*,.zip,.html,.css,.js,.ts,.tsx,.jsx,.json,.md,.txt,.csv,.xml,.svg,.yml,.yaml,.sql,.py"
                    className="sr-only"
                    onChange={(event) => {
                      handleAttachmentChange(event.target.files);
                      event.currentTarget.value = "";
                    }}
                    disabled={sendMutation.isPending || generationJobMutation.isPending || !!activeJobId || wizardMutation.isPending || wizardQuestions.length > 0 || readingAttachments}
                  />
                </label>
                <Button
                  size="icon"
                  className="absolute right-2 bottom-2 size-8 bg-gradient-primary"
                  onClick={handleSend}
                  disabled={
                    sendMutation.isPending ||
                    generationJobMutation.isPending ||
                    !!activeJobId ||
                    wizardMutation.isPending ||
                    wizardQuestions.length > 0 ||
                    readingAttachments ||
                    (!input.trim() && attachments.length === 0)
                  }
                >
                  {sendMutation.isPending || generationJobMutation.isPending || !!activeJobId ? (
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
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleReviewPreview}
                  disabled={!hasFiles || sendMutation.isPending || generationJobMutation.isPending || !!activeJobId}
                  title="Analisar preview com IA"
                >
                  <Sparkles className="size-3.5" /> Revisar visual
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
                    ref={previewFrameRef}
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
              <div className="w-64 border-r border-border bg-card/30 p-2 overflow-auto shrink-0 space-y-4">
                <div>
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
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground px-2 py-1">
                    Versões
                  </div>
                  {(versions as ProjectFileVersion[] | undefined)?.length ? (
                    <div className="space-y-2">
                      {(versions as ProjectFileVersion[]).map((version) => (
                        <div key={version.id} className="rounded-lg border border-border bg-background/70 p-2">
                          <div className="text-xs font-medium">{version.label}</div>
                          <div className="text-[11px] text-muted-foreground line-clamp-2 mt-1">
                            {version.summary || `Snapshot ${version.version_number}`}
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="mt-2 h-7 w-full text-xs"
                            onClick={() => revertVersionMutation.mutate(version.id)}
                            disabled={revertVersionMutation.isPending || generationJobMutation.isPending || !!activeJobId}
                          >
                            {revertVersionMutation.isPending ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                            Reverter
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-2 py-4 text-xs text-muted-foreground">Sem versões ainda.</div>
                  )}
                </div>
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

      <Dialog open={modelOpen} onOpenChange={setModelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modelo de IA deste projeto</DialogTitle>
            <DialogDescription>
              Escolha o modelo usado no Plan e no Build. Modelos Pro dependem de assinatura ativa.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {modelOptions.map((model) => {
              const locked = model.requiresSubscription && !hasSubscription;
              const active = selectedModel === model.id;
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => updateSelectedModel(model.id)}
                  className={`rounded-xl border p-4 text-left transition ${
                    active
                      ? "border-primary bg-primary/10"
                      : locked
                        ? "border-border bg-muted/20 opacity-70"
                        : "border-border bg-card hover:border-primary/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {model.label}
                        {locked && <Lock className="size-3.5 text-muted-foreground" />}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{model.description}</div>
                    </div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {model.requiresSubscription ? "Pro" : "Free"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={collabOpen} onOpenChange={setCollabOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Compartilhar projeto</DialogTitle>
            <DialogDescription>
              Colaboradores usam o projeto, mas os créditos debitados são sempre do dono.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={collabEmail}
                onChange={(e) => setCollabEmail(e.target.value)}
                placeholder="email@cliente.com"
              />
              <select
                value={collabRole}
                onChange={(e) => setCollabRole(e.target.value as "viewer" | "editor")}
                className="rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="editor">Editor</option>
                <option value="viewer">Visualizador</option>
              </select>
              <Button
                onClick={() => inviteMutation.mutate()}
                disabled={inviteMutation.isPending || !collabEmail.trim()}
              >
                {inviteMutation.isPending && <Loader2 className="size-4 animate-spin" />}
                Adicionar
              </Button>
            </div>
            <div className="space-y-2">
              {(collaborators ?? []).map((collab: any) => (
                <div key={collab.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <div className="text-sm font-medium">
                      {collab.profiles?.full_name || collab.profiles?.email || "Usuário"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {collab.profiles?.email} · {collab.role === "editor" ? "Editor" : "Visualizador"}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeCollaboratorMutation.mutate(collab.id)}
                    disabled={removeCollaboratorMutation.isPending}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
              {(!collaborators || collaborators.length === 0) && (
                <div className="text-sm text-muted-foreground">Nenhum colaborador ainda.</div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={skillsOpen} onOpenChange={setSkillsOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Skills do projeto</DialogTitle>
            <DialogDescription>
              Ative comportamentos que serão injetados no prompt da IA deste projeto.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {(skills ?? []).map((skill: any) => {
              const enabled = activeSkills?.has(skill.id) ?? false;
              return (
                <div key={skill.id} className="rounded-xl border border-border p-4 bg-card">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {skill.name}
                        {skill.is_global && <span className="text-[10px] uppercase text-primary">Global</span>}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{skill.description}</p>
                    </div>
                    <Button
                      variant={enabled ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleSkillMutation.mutate({ skillId: skill.id, active: !enabled })}
                      disabled={toggleSkillMutation.isPending || !skill.is_active}
                    >
                      {enabled ? "Ativa" : "Ativar"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

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
