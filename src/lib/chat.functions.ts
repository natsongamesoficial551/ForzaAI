import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SYSTEM_PROMPT = `Você é o ForzaAI, um assistente especialista em criar sites profissionais para empresários brasileiros.

REGRAS CRÍTICAS:
1. Se ainda não souber o suficiente (nome, setor, público, cores), FAÇA UMA PERGUNTA OBJETIVA. Não invente. Nesse caso defina files = [].
2. Quando tiver contexto suficiente, gere/atualize os arquivos: index.html, styles.css, script.js. Retorne SEMPRE os 3 arquivos completos.
3. HTML5 semântico, responsivo, mobile-first. Inclua hero, sobre, serviços, depoimentos e CTA/contato. Meta tags SEO completas, alt em todas as imagens, acessível.
4. CSS profissional com variáveis CSS, Google Fonts elegantes, animações sutis, design moderno e único — nada genérico.
5. JS apenas para interações (menu mobile, smooth scroll, validação). Zero dependências externas.
6. Para imagens use a tag especial: <img data-ai-gen="prompt em inglês descrevendo a imagem desejada" alt="..." class="..."> — o sistema gera automaticamente. Use até 4 imagens por site.
7. Responda em português do Brasil, amigável e direto. "message" é sua resposta curta no chat.

FORMATO OBRIGATÓRIO (apenas JSON, sem markdown):
{"message":"texto para o usuário","files":[{"path":"index.html","language":"html","content":"..."},{"path":"styles.css","language":"css","content":"..."},{"path":"script.js","language":"javascript","content":"..."}]}`;

const InputSchema = z.object({
  projectId: z.string().uuid(),
  message: z.string().min(1).max(4000),
});

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
  const supabaseUrl = process.env.SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
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

export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async function* ({ data, context }) {
    const { supabase, userId } = context;
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY ausente");

    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, name, site_type, description")
      .eq("id", data.projectId)
      .eq("user_id", userId)
      .single();
    if (projErr || !project) throw new Error("Projeto não encontrado");

    const { data: debited, error: debitErr } = await supabase.rpc("debit_credits", {
      _amount: 1,
      _description: `Mensagem no projeto ${project.name}`,
    });
    if (debitErr) throw new Error(debitErr.message);
    if (!debited) throw new Error("Créditos insuficientes.");

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

    yield { type: "status" as const, text: "Pensando…" };

    // Call DeepSeek with streaming
    const upstream = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        stream: true,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              SYSTEM_PROMPT +
              `\n\nProjeto: ${project.name} (${project.site_type})\nDescrição: ${project.description ?? "—"}\n\nArquivos atuais:\n${filesContext}`,
          },
          ...(history ?? []).map((m) => ({
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

    let buffer = "";
    let pending = "";
    const decoder = new TextDecoderStream();
    const reader = upstream.body.pipeThrough(decoder).getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += value;
      // Split on SSE event boundaries
      const parts = pending.split("\n\n");
      pending = parts.pop() ?? "";
      for (const evt of parts) {
        for (const line of evt.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload);
            const delta: string | undefined = parsed?.choices?.[0]?.delta?.content;
            if (delta) {
              buffer += delta;
              yield { type: "progress" as const, chars: buffer.length };
            }
          } catch {
            /* ignore partial */
          }
        }
      }
    }

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
          content: await processImageTags(out.files[idx].content, data.projectId, apiKey),
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
