import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type ForzaModelId, routeAiModel } from "./ai-model-router";
import { getServerEnv } from "./server-env";

const SYSTEM_PROMPT = `Você é o ForzaAI, um assistente especialista em criar sites profissionais para empresários brasileiros.

REGRAS CRÍTICAS:
1. Se ainda não souber o suficiente (nome, setor, público, cores), FAÇA UMA PERGUNTA OBJETIVA. Não invente. Nesse caso defina files = [].
2. Quando tiver contexto suficiente, gere/atualize os arquivos: index.html, styles.css, script.js. Retorne SEMPRE os 3 arquivos completos.
3. HTML5 semântico, responsivo, mobile-first. Inclua hero, sobre, serviços, depoimentos e CTA/contato. Meta tags SEO completas, alt em todas as imagens, acessível.
4. CSS profissional com variáveis CSS, Google Fonts elegantes, animações sutis, design moderno e único — nada genérico.
5. JS apenas para interações (menu mobile, smooth scroll, validação). Zero dependências externas.
6. Para imagens use a tag especial: <img data-ai-gen="prompt em inglês descrevendo a imagem desejada" alt="..." class="..."> — o sistema gera automaticamente. Use até 4 imagens por site.
7. Só crie recursos com IA dentro do site gerado quando o cliente pedir explicitamente, como chat com IA, analisador de PDF, gerador com IA ou assistente inteligente. Nesses casos, implemente a interface e deixe a chamada preparada para um endpoint backend protegido do ForzaAI; nunca peça API key ao usuário final e nunca exponha chave no HTML/JS.
8. Responda em português do Brasil, amigável e direto. "message" é sua resposta curta no chat.

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

export const generateProjectWizard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => WizardInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const hasSubscription = await hasActiveSubscription(supabase, userId);
    const model = routeAiModel({ hasSubscription, modelId: selectedModelId(data.modelId) });

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

    const upstream = await fetch(model.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${model.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model.upstreamModel,
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
      }),
    });

    if (!upstream.ok) {
      const errTxt = await upstream.text().catch(() => "");
      throw new Error(`Falha ao preparar perguntas (${upstream.status}): ${errTxt.slice(0, 200)}`);
    }

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
    const hasSubscription = await hasActiveSubscription(supabase, userId);
    const model = routeAiModel({ hasSubscription, modelId: selectedModelId(data.modelId) });

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

    const creditCost = Math.ceil(model.creditMultiplier);
    const { data: debited, error: debitErr } = await supabase.rpc("debit_project_owner_credits", {
      _project_id: data.projectId,
      _amount: creditCost,
      _description: `${model.label} no projeto ${project.name}`,
    });
    if (debitErr) throw new Error(debitErr.message);
    if (!debited) throw new Error("Créditos insuficientes do dono do projeto.");

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

    yield { type: "status" as const, text: "Pensando…" };

    yield { type: "status" as const, text: `Usando ${model.label}…` };

    const upstream = await fetch(model.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${model.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model.upstreamModel,
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
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const errTxt = await upstream.text().catch(() => "");
      if (upstream.status === 402) throw new Error("Créditos da DeepSeek esgotados.");
      if (upstream.status === 429)
        throw new Error("Limite de requisições atingido. Aguarde alguns segundos.");
      throw new Error(`Falha na API da DeepSeek (${upstream.status}): ${errTxt.slice(0, 200)}`);
    }

    const payload = await upstream.json();
    const buffer = payload?.choices?.[0]?.message?.content;
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

    const out = normalizeOutput(parsed);

    if (out.files.length > 0) {
      yield { type: "status" as const, text: "Gerando imagens…" };
      const idx = out.files.findIndex((f) => f.path === "index.html");
      if (idx >= 0) {
        out.files[idx] = {
          ...out.files[idx],
          content: await processImageTags(out.files[idx].content, data.projectId, model.apiKey),
        };
      }
    }

    await supabase.from("messages").insert({
      conversation_id: convo.id,
      role: "assistant",
      content: out.message,
    });

    if (out.files.length > 0) {
      for (const f of out.files) {
        const { data: existing } = await supabase
          .from("project_files")
          .select("id")
          .eq("project_id", data.projectId)
          .eq("path", f.path)
          .maybeSingle();
        if (existing) {
          await supabase
            .from("project_files")
            .update({
              content: f.content,
              language: f.language,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.id);
        } else {
          await supabase.from("project_files").insert({
            project_id: data.projectId,
            path: f.path,
            language: f.language,
            content: f.content,
          });
        }
      }
      await supabase
        .from("projects")
        .update({
          status: "active",
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.projectId);
    }

    yield { type: "done" as const, message: out.message, filesUpdated: out.files.length };
  });
