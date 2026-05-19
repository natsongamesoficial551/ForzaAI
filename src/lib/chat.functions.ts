import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type ForzaModelId, type RoutedAiModel, routeAiModel } from "./ai-model-router";
import { getOptionalServerEnv, getServerEnv } from "./server-env";

const SYSTEM_PROMPT = `Você é o ForzaAI, um assistente especialista em criar sites profissionais para empresários brasileiros.

REGRAS CRÍTICAS:
1. Se ainda não souber o suficiente (nome, setor, público, cores), FAÇA UMA PERGUNTA OBJETIVA. Não invente. Nesse caso defina files = [].
2. Quando a mensagem incluir "Modo Build", NÃO faça novas perguntas: use escolhas profissionais coerentes para qualquer detalhe faltante e gere os arquivos.
3. Quando tiver contexto suficiente ou estiver em Modo Build, gere/atualize os arquivos: index.html, styles.css, script.js. Retorne SEMPRE os 3 arquivos completos.
4. HTML5 semântico, responsivo, mobile-first. Inclua hero, sobre, serviços, depoimentos e CTA/contato. Meta tags SEO completas, alt em todas as imagens, acessível.
5. CSS profissional com variáveis CSS, Google Fonts elegantes, animações sutis, design moderno e único — nada genérico.
6. JS apenas para interações (menu mobile, smooth scroll, validação). Zero dependências externas.
7. Para imagens use a tag especial: <img data-ai-gen="prompt em inglês descrevendo a imagem desejada" alt="..." class="..."> — o sistema gera automaticamente. Use até 4 imagens por site.
8. Só crie recursos com IA dentro do site gerado quando o cliente pedir explicitamente, como chat com IA, analisador de PDF, gerador com IA ou assistente inteligente. Nesses casos, implemente a interface e deixe a chamada preparada para um endpoint backend protegido do ForzaAI; nunca peça API key ao usuário final e nunca exponha chave no HTML/JS.
9. Responda em português do Brasil, amigável e direto. "message" é sua resposta curta no chat.

FORMATO OBRIGATÓRIO (apenas JSON, sem markdown):
{"message":"texto para o usuário","files":[{"path":"index.html","language":"html","content":"..."},{"path":"styles.css","language":"css","content":"..."},{"path":"script.js","language":"javascript","content":"..."}]}`;

const ModelSchema = z.enum(["forza-1-flash", "forza-1-pro", "forza-2-pro", "forza-2-5-thinking"]);

const AttachmentSchema = z.object({
  name: z.string().min(1).max(180),
  type: z.string().max(120).optional(),
  size: z.number().int().nonnegative().max(8_000_000),
  kind: z.enum(["image", "zip", "text", "file"]),
  content: z.string().max(120_000),
});

const InputSchema = z.object({
  projectId: z.string().uuid(),
  message: z.string().min(1).max(12000),
  modelId: ModelSchema.optional(),
  attachments: z.array(AttachmentSchema).max(6).optional(),
  previewSnapshot: z
    .object({
      viewport: z.enum(["desktop", "tablet", "mobile"]),
      html: z.string().max(120_000),
    })
    .optional(),
});

const JobInputSchema = InputSchema.pick({
  projectId: true,
  message: true,
  modelId: true,
});

const JobStatusInputSchema = z.object({
  jobId: z.string().uuid(),
});

const EngineVersionInputSchema = z.object({
  projectId: z.string().uuid(),
});

const RevertVersionInputSchema = z.object({
  projectId: z.string().uuid(),
  versionId: z.string().uuid(),
});

const WizardInputSchema = z.object({
  projectId: z.string().uuid(),
  prompt: z.string().min(6).max(4000),
  modelId: ModelSchema.optional(),
});

const WizardOutputSchema = z.object({
  shouldAsk: z.boolean(),
  summary: z.string().optional(),
  questions: z
    .array(
      z.object({
        id: z.string().min(1),
        question: z.string().min(1),
        options: z.array(z.string().min(1)).min(2).max(5),
      }),
    )
    .min(0)
    .max(20),
});

type WizardQuestion = z.infer<typeof WizardOutputSchema>["questions"][number];

type ChatAttachment = z.infer<typeof AttachmentSchema>;

type GeneratedFile = {
  path: "index.html" | "styles.css" | "script.js";
  language: "html" | "css" | "javascript";
  content: string;
};

function normalizePath(value: unknown): GeneratedFile["path"] | null {
  if (typeof value !== "string") return null;
  const p = value.trim().toLowerCase().replace(/^\/+/, "");
  if (p.endsWith("index.html")) return "index.html";
  if (p.endsWith("styles.css") || p.endsWith("style.css")) return "styles.css";
  if (p.endsWith("script.js") || p.endsWith("scripts.js") || p.endsWith("main.js"))
    return "script.js";
  return null;
}

function languageFor(p: GeneratedFile["path"]): GeneratedFile["language"] {
  if (p === "index.html") return "html";
  if (p === "styles.css") return "css";
  return "javascript";
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  // Strip fences if present
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fence ? fence[1] : trimmed).trim();
  // Find first { and matching last }
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Sem JSON na resposta");
  return JSON.parse(body.slice(start, end + 1));
}

function normalizeOutput(raw: unknown): { message: string; files: GeneratedFile[] } {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const filesRaw = Array.isArray(obj.files) ? obj.files : [];
  const files: GeneratedFile[] = [];
  for (const f of filesRaw) {
    const fo = (f ?? {}) as Record<string, unknown>;
    const path = normalizePath(fo.path);
    const content = typeof fo.content === "string" ? fo.content : "";
    if (!path || !content.trim()) continue;
    files.push({ path, language: languageFor(path), content });
  }
  const message = typeof obj.message === "string" ? obj.message.trim() : "";
  return {
    message:
      message || (files.length > 0 ? "Pronto — atualizei seu site." : "Preciso de mais detalhes."),
    files,
  };
}

function stripGeneratedCode(text: string, language?: string) {
  const trimmed = text.trim();
  const langFence = language
    ? trimmed.match(new RegExp("```" + language + "\\s*([\\s\\S]*?)```", "i"))
    : null;
  const anyFence = trimmed.match(/```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/);
  return (langFence?.[1] ?? anyFence?.[1] ?? trimmed).trim();
}

export async function saveGeneratedFiles(supabase: any, projectId: string, files: GeneratedFile[]) {
  for (const f of files) {
    const { data: existing, error: lookupError } = await supabase
      .from("project_files")
      .select("id")
      .eq("project_id", projectId)
      .eq("path", f.path)
      .maybeSingle();
    if (lookupError) throw lookupError;

    if (existing) {
      const { error } = await supabase
        .from("project_files")
        .update({
          content: f.content,
          language: f.language,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("project_files").insert({
        project_id: projectId,
        path: f.path,
        language: f.language,
        content: f.content,
      });
      if (error) throw error;
    }
  }

  const { error: projectUpdateErr } = await supabase
    .from("projects")
    .update({
      status: "active",
      updated_at: new Date().toISOString(),
    })
    .eq("id", projectId);
  if (projectUpdateErr) throw projectUpdateErr;
}

function normalizeWizard(raw: unknown): { shouldAsk: boolean; summary?: string; questions: WizardQuestion[] } {
  const parsed = WizardOutputSchema.parse(raw);
  const questions = parsed.questions.slice(0, 20).map((question, index) => ({
    id: question.id || `q${index + 1}`,
    question: question.question,
    options: question.options.slice(0, 5),
  }));

  return {
    shouldAsk: parsed.shouldAsk && questions.length >= 10,
    summary: parsed.summary,
    questions,
  };
}

function buildAttachmentContext(attachments: ChatAttachment[] | undefined) {
  if (!attachments || attachments.length === 0) return "";
  return attachments
    .map((attachment, index) => {
      const header = `ANEXO ${index + 1}: ${attachment.name}\nTipo: ${attachment.type || attachment.kind}\nTamanho: ${attachment.size} bytes`;
      if (attachment.kind === "image") {
        return `${header}\nImagem em base64/data URL para análise visual. Observe layout, erro visual, texto e componentes visíveis:\n${attachment.content}`;
      }
      if (attachment.kind === "zip") {
        return `${header}\nArquivo ZIP recebido. Se o conteúdo for um projeto, use a listagem/resumo abaixo para inferir estrutura e peça arquivos específicos caso falte contexto:\n${attachment.content}`;
      }
      return `${header}\nConteúdo extraído para análise:\n${attachment.content}`;
    })
    .join("\n\n");
}

function buildPreviewContext(previewSnapshot: { viewport: "desktop" | "tablet" | "mobile"; html: string } | undefined) {
  if (!previewSnapshot) return "";
  return `REVISAO VISUAL DO PREVIEW (${previewSnapshot.viewport}):\nAnalise o documento renderizado abaixo como se estivesse revisando um print do site. Procure erros visuais prováveis, quebras responsivas, contraste ruim, espaçamentos estranhos, conteúdo cortado, CTAs fracos, problemas de acessibilidade e inconsistências. Se encontrar problemas, corrija nos arquivos completos.\n\n${previewSnapshot.html}`;
}

async function generateAndUploadImage(_opts: {
  prompt: string;
  projectId: string;
  apiKey: string;
  supabaseUrl: string;
  serviceKey: string;
}): Promise<string | null> {
  return null;
}

async function processImageTags(html: string, projectId: string, apiKey: string): Promise<string> {
  const supabaseUrl = getServerEnv("SUPABASE_URL");
  const serviceKey = getServerEnv("SUPABASE_SERVICE_ROLE_KEY");
  const re = /<img\b[^>]*?\bdata-ai-gen="([^"]+)"[^>]*>/gi;
  const tags: { full: string; prompt: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) tags.push({ full: m[0], prompt: m[1] });
  if (tags.length === 0) return html;
  // Cap at 4 to avoid timeouts/cost
  const unique = Array.from(new Map(tags.map((t) => [t.prompt, t])).values()).slice(0, 4);
  const results = await Promise.all(
    unique.map((t) =>
      generateAndUploadImage({ prompt: t.prompt, projectId, apiKey, supabaseUrl, serviceKey }),
    ),
  );
  const map = new Map<string, string | null>();
  unique.forEach((t, i) => map.set(t.prompt, results[i]));
  return html.replace(re, (full, prompt: string) => {
    const url = map.get(prompt);
    if (!url)
      return full.replace(
        /data-ai-gen="[^"]+"/,
        `src="https://placehold.co/1200x800/png?text=image"`,
      );
    if (/\bsrc=/.test(full)) {
      return full.replace(/\bsrc="[^"]*"/, `src="${url}"`);
    }
    return full.replace(/<img\b/, `<img src="${url}"`);
  });
}

async function hasActiveSubscription(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_active_subscription", { _user_id: userId });
  if (!error) return !!data;

  const fallback = await supabase.rpc("has_active_subscription");
  if (fallback.error) return false;
  return !!fallback.data;
}

function selectedModelId(modelId: ForzaModelId | undefined) {
  return modelId ?? "forza-1-flash";
}

async function loadActiveSkills(supabase: any, projectId: string) {
  const { data } = await supabase
    .from("project_skill_activations")
    .select("ai_skills(name, description, prompt)")
    .eq("project_id", projectId);

  return (data ?? [])
    .map((row: any) => row.ai_skills)
    .filter(Boolean)
    .map((skill: any) => `Skill: ${skill.name}\nDescrição: ${skill.description}\nInstrução: ${skill.prompt}`)
    .join("\n\n");
}

function aiHeaders(model: RoutedAiModel) {
  return {
    Authorization: `Bearer ${model.apiKey}`,
    "Content-Type": "application/json",
  };
}

const AI_REQUEST_TIMEOUT_MS = 240_000;

async function fetchAiCompletion(model: RoutedAiModel, body: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  let upstream: Response;

  console.log("[AI generation] fetch-start", {
    provider: model.provider,
    model: model.id,
    upstreamModel: model.upstreamModel,
  });

  try {
    upstream = await fetch(model.endpoint, {
      method: "POST",
      headers: aiHeaders(model),
      signal: controller.signal,
      body: JSON.stringify({ ...body, model: model.upstreamModel }),
    });
  } catch (error) {
    console.error("[AI generation] fetch-error", {
      ms: Date.now() - startedAt,
      provider: model.provider,
      model: model.id,
      upstreamModel: model.upstreamModel,
      error,
    });
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("A IA demorou demais para responder. Em produção, requests longas podem ser encerradas pela hospedagem; tente novamente ou escolha um modelo mais rápido.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  console.log("[AI generation] fetch-end", {
    ms: Date.now() - startedAt,
    status: upstream.status,
    provider: model.provider,
    model: model.id,
    upstreamModel: model.upstreamModel,
  });

  if (upstream.ok) return upstream;

  const errTxt = await upstream.text().catch(() => "");
  if (upstream.status === 402) throw new Error("Créditos da DeepSeek esgotados.");
  if (upstream.status === 429) throw new Error("Limite da DeepSeek atingido. Aguarde alguns segundos.");
  throw new Error(`Falha na DeepSeek (${upstream.status}): ${errTxt.slice(0, 240)}`);
}

export async function fetchAiText(model: RoutedAiModel, body: Record<string, unknown>) {
  const upstream = await fetchAiCompletion(model, body);
  const payload = await upstream.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("A IA retornou uma resposta vazia. Tente novamente.");
  }
  return content;
}

function extractDelimitedFile(text: string, path: GeneratedFile["path"]) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`===\\s*${escaped}\\s*===\\s*([\\s\\S]*?)(?=\\n===\\s*(?:index\\.html|styles\\.css|script\\.js)\\s*===|$)`, "i");
  return stripGeneratedCode(text.match(re)?.[1] ?? "", languageFor(path)).trim();
}

export async function generateReliableSiteFiles(opts: {
  model: RoutedAiModel;
  project: { name: string; site_type: string; description?: string | null };
  userBrief: string;
  filesContext: string;
  skillsContext: string;
}) {
  const baseContext = `Projeto: ${opts.project.name} (${opts.project.site_type})\nDescrição: ${opts.project.description ?? "—"}${opts.skillsContext ? `\n\nSKILLS ATIVAS DO PROJETO:\n${opts.skillsContext}` : ""}\n\nArquivos atuais:\n${opts.filesContext}\n\nPedido do usuário:\n${opts.userBrief}`;

  const content = await fetchAiText(opts.model, {
    stream: false,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "Você é o ForzaAI, um gerador de sites profissional nível Lovable. Gere um site completo e bonito em UMA resposta, sem JSON e sem markdown. O formato obrigatório é exatamente:\n=== index.html ===\n...HTML completo...\n=== styles.css ===\n...CSS completo...\n=== script.js ===\n...JS completo...\nHTML deve linkar styles.css e script.js, ser mobile-first, semântico, com SEO, acessível e copy em português do Brasil. CSS deve ser refinado, moderno, responsivo, com variáveis e Google Fonts. JS deve ser puro, seguro e simples. Não faça perguntas em Build: escolha detalhes profissionais coerentes.",
      },
      { role: "user", content: baseContext },
    ],
  });

  let html = extractDelimitedFile(content, "index.html");
  const css = extractDelimitedFile(content, "styles.css");
  const js = extractDelimitedFile(content, "script.js");

  if (!html || !css || !js) {
    throw new Error("A IA não retornou os 3 arquivos no formato correto. Tente novamente ou use um modelo Pro.");
  }

  if (!/<html[\s>]/i.test(html)) {
    html = `<!doctype html>\n<html lang="pt-BR">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>${opts.project.name}</title>\n  <link rel="stylesheet" href="styles.css" />\n</head>\n<body>\n${html}\n  <script src="script.js"></script>\n</body>\n</html>`;
  }
  if (!/styles\.css/i.test(html)) html = html.replace(/<\/head>/i, '  <link rel="stylesheet" href="styles.css" />\n</head>');
  if (!/script\.js/i.test(html)) html = html.replace(/<\/body>/i, '  <script src="script.js"></script>\n</body>');

  return {
    message: "Pronto — gerei seu site completo com HTML, CSS e JavaScript.",
    files: [
      { path: "index.html", language: "html", content: html },
      { path: "styles.css", language: "css", content: css },
      { path: "script.js", language: "javascript", content: js },
    ] satisfies GeneratedFile[],
  };
}

export const startGenerationJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => JobInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: canEdit } = await supabase.rpc("can_edit_project", {
      _project_id: data.projectId,
      _user_id: userId,
    });
    if (!canEdit) throw new Error("Projeto não encontrado");

    const { data: job, error } = await supabase
      .from("generation_jobs")
      .insert({
        project_id: data.projectId,
        user_id: userId,
        model_id: selectedModelId(data.modelId),
        message: data.message,
        status: "queued",
        stage: "Na fila para gerar…",
      })
      .select("id, status, stage")
      .single();
    if (error) throw error;

    const engineUrl = getOptionalServerEnv("FORZA_ENGINE_URL");
    const engineSecret = getOptionalServerEnv("FORZA_ENGINE_SECRET") || getServerEnv("SUPABASE_SERVICE_ROLE_KEY");
    const baseUrl = getOptionalServerEnv("URL") || getOptionalServerEnv("DEPLOY_PRIME_URL");
    const backgroundUrl = engineUrl
      ? `${engineUrl.replace(/\/$/, "")}/generate-site-background`
      : baseUrl
        ? `${baseUrl}/.netlify/functions/generate-site-background`
        : null;
    if (!backgroundUrl) throw new Error("URL do motor de geração não configurada.");

    fetch(backgroundUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-generation-secret": engineSecret,
      },
      body: JSON.stringify({ jobId: job.id }),
    }).catch((error) => console.error("[AI generation] background-start-error", error));

    return job;
  });

export const getGenerationJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => JobStatusInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: job, error } = await context.supabase
      .from("generation_jobs")
      .select("id, project_id, status, stage, error, files_updated, created_at, updated_at, completed_at")
      .eq("id", data.jobId)
      .eq("user_id", context.userId)
      .single();
    if (error) throw error;

    const { data: engineRun } = await context.supabase
      .from("engine_runs")
      .select("id, status, phase, mode, plan, current_version_id, error, created_at, updated_at, completed_at")
      .eq("generation_job_id", data.jobId)
      .maybeSingle();

    const runId = engineRun?.id;
    const [{ data: tasks }, { data: artifacts }, { data: version }] = await Promise.all([
      runId
        ? context.supabase
            .from("engine_tasks")
            .select("id, position, phase, title, description, status, output, error, created_at, updated_at, completed_at")
            .eq("run_id", runId)
            .order("position")
        : Promise.resolve({ data: [] }),
      runId
        ? context.supabase
            .from("engine_artifacts")
            .select("id, kind, content, created_at")
            .eq("run_id", runId)
            .in("kind", ["validation_report", "product_plan", "technical_plan"])
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] }),
      engineRun?.current_version_id
        ? context.supabase
            .from("project_file_versions")
            .select("id, version_number, label, summary, created_at")
            .eq("id", engineRun.current_version_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    return {
      ...job,
      engineRun: engineRun
        ? {
            ...engineRun,
            tasks: tasks ?? [],
            artifacts: artifacts ?? [],
            version,
          }
        : null,
    };
  });

export const listProjectFileVersions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => EngineVersionInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: canEdit } = await context.supabase.rpc("can_edit_project", {
      _project_id: data.projectId,
      _user_id: context.userId,
    });
    if (!canEdit) throw new Error("Projeto não encontrado");

    const { data: versions, error } = await context.supabase
      .from("project_file_versions")
      .select("id, version_number, label, summary, created_at")
      .eq("project_id", data.projectId)
      .order("version_number", { ascending: false })
      .limit(20);
    if (error) throw error;
    return versions ?? [];
  });

export const revertProjectFileVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RevertVersionInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: canEdit } = await context.supabase.rpc("can_edit_project", {
      _project_id: data.projectId,
      _user_id: context.userId,
    });
    if (!canEdit) throw new Error("Projeto não encontrado");

    const { data: version, error } = await context.supabase
      .from("project_file_versions")
      .select("id, files")
      .eq("id", data.versionId)
      .eq("project_id", data.projectId)
      .single();
    if (error || !version) throw error ?? new Error("Versão não encontrada");

    const files = Array.isArray(version.files)
      ? version.files
          .map((file) => {
            const obj = file as Record<string, unknown>;
            const path = normalizePath(obj.path);
            const content = typeof obj.content === "string" ? obj.content : "";
            if (!path || !content.trim()) return null;
            return { path, language: languageFor(path), content } satisfies GeneratedFile;
          })
          .filter(Boolean)
      : [];
    if (files.length === 0) throw new Error("Essa versão não tem arquivos válidos.");

    await saveGeneratedFiles(context.supabase, data.projectId, files as GeneratedFile[]);
    return { filesUpdated: files.length };
  });

export const generateProjectWizard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => WizardInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const hasSubscription = await hasActiveSubscription(supabase, userId);
    const model = await routeAiModel({ hasSubscription, modelId: selectedModelId(data.modelId) });

    const { data: canEdit } = await supabase.rpc("can_edit_project", {
      _project_id: data.projectId,
      _user_id: userId,
    });
    if (!canEdit) throw new Error("Projeto não encontrado");

    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, name, site_type, description")
      .eq("id", data.projectId)
      .single();
    if (projErr || !project) throw new Error("Projeto não encontrado");

    const upstream = await fetchAiCompletion(model, {
      stream: false,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Você é o wizard anti-alucinação do ForzaAI. Analise o primeiro prompt do usuário. Se for pedido de site, landing page, SaaS, app, produto digital, e-commerce, portfólio ou sistema, retorne shouldAsk=true e gere de 10 a 20 perguntas obrigatórias de múltipla escolha para coletar contexto antes da criação. Cada pergunta deve ter 2 a 5 opções curtas. Se não for pedido de criação/planejamento de produto, retorne shouldAsk=false e questions=[]. Responda apenas JSON no formato {\"shouldAsk\":boolean,\"summary\":\"...\",\"questions\":[{\"id\":\"q1\",\"question\":\"...\",\"options\":[\"...\"]}]}",
        },
        {
          role: "user",
          content: `Projeto: ${project.name}\nTipo atual: ${project.site_type}\nDescrição atual: ${project.description ?? "—"}\nPrompt inicial: ${data.prompt}`,
        },
      ],
    });

    const payload = await upstream.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("Resposta inválida do wizard");

    const wizard = normalizeWizard(extractJson(content));
    if (wizard.shouldAsk) {
      await supabase.from("project_memory").upsert(
        {
          project_id: data.projectId,
          category: "wizard",
          key: "initial_questions",
          value: JSON.stringify({ prompt: data.prompt, ...wizard }),
        },
        { onConflict: "project_id,key" },
      );
    }

    return wizard;
  });

export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async function* ({ data, context }) {
    const { supabase, userId } = context;
    const startedAt = Date.now();
    const logStage = (stage: string, extra: Record<string, unknown> = {}) => {
      console.log("[AI generation] stage", { stage, ms: Date.now() - startedAt, ...extra });
    };

    yield { type: "status" as const, text: "Validando projeto…" };
    logStage("auth-start");
    const hasSubscription = await hasActiveSubscription(supabase, userId);
    const model = await routeAiModel({ hasSubscription, modelId: selectedModelId(data.modelId) });
    logStage("model-routed", {
      model: model.id,
      label: model.label,
      provider: model.provider,
      upstreamModel: model.upstreamModel,
    });

    const { data: canEdit } = await supabase.rpc("can_edit_project", {
      _project_id: data.projectId,
      _user_id: userId,
    });
    if (!canEdit) throw new Error("Projeto não encontrado");

    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, name, site_type, description, user_id")
      .eq("id", data.projectId)
      .single();
    if (projErr || !project) throw new Error("Projeto não encontrado");
    logStage("project-loaded", { projectId: project.id });

    yield { type: "status" as const, text: "Debitando créditos…" };
    const creditCost = Math.ceil(model.creditMultiplier);
    const { data: debited, error: debitErr } = await supabase.rpc("debit_project_owner_credits", {
      _project_id: data.projectId,
      _amount: creditCost,
      _description: `${model.label} no projeto ${project.name}`,
    });
    if (debitErr) throw new Error(debitErr.message);
    if (!debited) throw new Error("Créditos insuficientes do dono do projeto.");
    logStage("credits-debited", { creditCost });

    yield { type: "status" as const, text: "Carregando conversa…" };
    let { data: convo } = await supabase
      .from("conversations")
      .select("id")
      .eq("project_id", data.projectId)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (!convo) {
      const { data: created, error } = await supabase
        .from("conversations")
        .insert({ project_id: data.projectId, title: "Conversa principal" })
        .select("id")
        .single();
      if (error) throw error;
      convo = created;
    }
    logStage("conversation-ready", { conversationId: convo.id });

    yield { type: "status" as const, text: "Preparando contexto…" };
    const attachmentContext = buildAttachmentContext(data.attachments);
    const previewContext = buildPreviewContext(data.previewSnapshot);
    const enrichedMessage = [
      data.message,
      attachmentContext ? `\n\n${attachmentContext}` : "",
      previewContext ? `\n\n${previewContext}` : "",
    ].join("");

    await supabase.from("messages").insert({
      conversation_id: convo.id,
      role: "user",
      content: data.message,
    });

    const { data: history } = await supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", convo.id)
      .order("created_at")
      .limit(40);

    const { data: currentFiles } = await supabase
      .from("project_files")
      .select("path, content")
      .eq("project_id", data.projectId);
    const filesContext =
      (currentFiles ?? []).map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n") ||
      "(sem arquivos ainda)";
    const skillsContext = await loadActiveSkills(supabase, data.projectId);
    const currentTurn = {
      role: "user" as const,
      content: enrichedMessage,
    };
    const historyForModel = [...(history ?? []).slice(0, -1), currentTurn];
    logStage("context-ready", {
      historyCount: history?.length ?? 0,
      fileCount: currentFiles?.length ?? 0,
      hasAttachments: Boolean(data.attachments?.length),
      hasPreviewSnapshot: Boolean(data.previewSnapshot),
    });

    const isBuildRequest = /Modo Build/i.test(data.message) || (!(currentFiles?.length) && /gere|crie|site|landing|portf[oó]lio|p[aá]gina/i.test(data.message));
    let out: { message: string; files: GeneratedFile[] };

    if (isBuildRequest) {
      yield { type: "status" as const, text: `Iniciando geração completa com ${model.label}…` };
      logStage("build-file-generation-start");
      out = await generateReliableSiteFiles({
        model,
        project,
        userBrief: enrichedMessage,
        filesContext,
        skillsContext,
      });
      logStage("build-file-generation-done", { files: out.files.length });
      yield { type: "progress" as const, chars: out.files.reduce((sum, file) => sum + file.content.length, 0) };
    } else {
      yield { type: "status" as const, text: `Chamando ${model.label} (${model.upstreamModel})…` };
      const upstream = await fetchAiCompletion(model, {
        stream: false,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              SYSTEM_PROMPT +
              `\n\nProjeto: ${project.name} (${project.site_type})\nDescrição: ${project.description ?? "—"}${skillsContext ? `\n\nSKILLS ATIVAS DO PROJETO:\n${skillsContext}` : ""}\n\nArquivos atuais:\n${filesContext}`,
          },
          ...historyForModel.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
        ],
      });

      yield { type: "status" as const, text: "Resposta recebida, estruturando arquivos…" };
      const payload = await upstream.json();
      const buffer = payload?.choices?.[0]?.message?.content;
      logStage("response-loaded", { chars: typeof buffer === "string" ? buffer.length : 0 });
      if (typeof buffer !== "string") {
        const fallback = "A IA retornou uma resposta inválida agora. Tente novamente em alguns segundos.";
        await supabase.from("messages").insert({
          conversation_id: convo.id,
          role: "assistant",
          content: fallback,
        });
        yield { type: "done" as const, message: fallback, filesUpdated: 0 };
        return;
      }
      yield { type: "progress" as const, chars: buffer.length };

      let parsed: unknown;
      try {
        parsed = extractJson(buffer);
      } catch (e) {
        console.error("Falha ao parsear JSON da IA", e, buffer.slice(0, 400));
        const fallback =
          "Não consegui estruturar a resposta agora. Reformule a instrução de forma mais curta.";
        await supabase.from("messages").insert({
          conversation_id: convo.id,
          role: "assistant",
          content: fallback,
        });
        yield { type: "done" as const, message: fallback, filesUpdated: 0 };
        return;
      }

      out = normalizeOutput(parsed);
      logStage("json-normalized", { files: out.files.length, isBuildRequest });
    }

    if (out.files.length > 0) {
      yield { type: "status" as const, text: "Preparando imagens…" };
      const idx = out.files.findIndex((f) => f.path === "index.html");
      if (idx >= 0) {
        try {
          out.files[idx] = {
            ...out.files[idx],
            content: await processImageTags(out.files[idx].content, data.projectId, model.apiKey),
          };
        } catch (error) {
          console.error("[AI generation] image-processing-error", error);
        }
      }
    }

    const { error: assistantMessageErr } = await supabase.from("messages").insert({
      conversation_id: convo.id,
      role: "assistant",
      content: out.message,
    });
    if (assistantMessageErr) throw assistantMessageErr;

    if (out.files.length > 0) {
      yield { type: "status" as const, text: "Salvando arquivos…" };
      await saveGeneratedFiles(supabase, data.projectId, out.files);
    }

    logStage("done", { filesUpdated: out.files.length });
    yield { type: "done" as const, message: out.message, filesUpdated: out.files.length };
  });
