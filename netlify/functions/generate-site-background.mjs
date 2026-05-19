import { createClient } from "@supabase/supabase-js";

const AI_REQUEST_TIMEOUT_MS = 600_000;
const MODEL_IDS = new Set(["forza-1-flash", "forza-1-pro", "forza-2-pro", "forza-2-5-thinking"]);

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

const updateJob = async (supabase, jobId, patch) => {
  const { error } = await supabase
    .from("generation_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", jobId);
  if (error) console.error("[background generation] job update failed", error);
};

function stripGeneratedCode(text, language) {
  const trimmed = String(text || "").trim();
  const langFence = language
    ? trimmed.match(new RegExp("```" + language + "\\s*([\\s\\S]*?)```", "i"))
    : null;
  const anyFence = trimmed.match(/```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/);
  return (langFence?.[1] ?? anyFence?.[1] ?? trimmed).trim();
}

function extractDelimitedFile(text, path) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const names = "index\\.html|styles\\.css|style\\.css|script\\.js|scripts\\.js|main\\.js|app\\.js";
  const alias = path === "styles.css" ? "(?:styles|style)\\.css" : path === "script.js" ? "(?:script|scripts|main|app)\\.js" : escaped;
  const re = new RegExp(`(?:^|\\n)\\s*(?:={3,}|---|###|##)?\\s*(?:file:?\\s*)?${alias}\\s*(?:={3,}|---)?\\s*\\n([\\s\\S]*?)(?=\\n\\s*(?:={3,}|---|###|##)?\\s*(?:file:?\\s*)?(?:${names})\\s*(?:={3,}|---)?\\s*\\n|$)`, "i");
  const language = path === "index.html" ? "html" : path === "styles.css" ? "css" : "javascript";
  return stripGeneratedCode(text.match(re)?.[1] ?? "", language).trim();
}

function extractFence(text, language) {
  return String(text || "").match(new RegExp("```" + language + "\\s*([\\s\\S]*?)```", "i"))?.[1]?.trim() ?? "";
}

function normalizeGeneratedFiles(text, projectName) {
  let html = extractDelimitedFile(text, "index.html");
  let css = extractDelimitedFile(text, "styles.css");
  let js = extractDelimitedFile(text, "script.js");

  if (!html) html = extractFence(text, "html");
  if (!css) css = extractFence(text, "css");
  if (!js) js = extractFence(text, "(?:js|javascript)");

  const fullHtml = String(text || "").match(/<!doctype html[\s\S]*?<\/html>/i)?.[0]
    ?? String(text || "").match(/<html[\s\S]*?<\/html>/i)?.[0]
    ?? "";
  if (!html && fullHtml) html = fullHtml.trim();

  if (html) {
    if (!css) css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1].trim()).join("\n\n");
    if (!js) js = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1].trim()).filter((code) => code && !/application\/ld\+json/i.test(code)).join("\n\n");
    if (css) html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
    if (js) html = html.replace(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi, "");
  }

  if (!html || !/<(?:!doctype|html|head|body|main|section|div|header|nav|footer)\b/i.test(html)) return null;
  if (!css) css = ":root{font-family:Inter,system-ui,sans-serif;color:#111827;background:#ffffff}body{margin:0}main{min-height:100vh}";
  if (!js) js = "document.documentElement.classList.add('js-ready');";

  if (!/<html[\s>]/i.test(html)) {
    html = `<!doctype html>\n<html lang="pt-BR">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>${projectName}</title>\n  <link rel="stylesheet" href="styles.css" />\n</head>\n<body>\n${html}\n  <script src="script.js"></script>\n</body>\n</html>`;
  }
  if (!/styles\.css/i.test(html)) html = html.replace(/<\/head>/i, '  <link rel="stylesheet" href="styles.css" />\n</head>');
  if (!/script\.js/i.test(html)) html = html.replace(/<\/body>/i, '  <script src="script.js"></script>\n</body>');

  return [
    { path: "index.html", language: "html", content: html.trim() },
    { path: "styles.css", language: "css", content: css.trim() },
    { path: "script.js", language: "javascript", content: js.trim() },
  ];
}

async function routeModel(supabase, modelId, hasSubscription) {
  const requestedModel = MODEL_IDS.has(modelId) ? modelId : "forza-1-flash";
  const deepSeekKey = process.env.DEEPSEEK_API_KEY;
  const { data: setting } = await supabase
    .from("ai_provider_settings")
    .select("provider, label, endpoint, upstream_model, api_key, requires_subscription, credit_multiplier, is_enabled")
    .eq("forza_model_id", requestedModel)
    .eq("is_enabled", true)
    .maybeSingle();

  if (setting) {
    if (setting.requires_subscription && !hasSubscription) throw new Error("Esse modelo é exclusivo para assinantes Pro.");
    const apiKey = setting.api_key || (setting.provider === "deepseek" ? deepSeekKey : null);
    if (!apiKey) throw new Error(`API key não configurada para ${setting.label}.`);
    return {
      id: requestedModel,
      label: setting.label,
      provider: setting.provider,
      endpoint: setting.endpoint,
      upstreamModel: setting.upstream_model,
      apiKey,
      creditMultiplier: Number(setting.credit_multiplier || 1),
    };
  }

  if ((requestedModel === "forza-2-pro" || requestedModel === "forza-2-5-thinking") && !hasSubscription) {
    throw new Error("Esse modelo é exclusivo para assinantes Pro.");
  }
  if (!deepSeekKey) throw new Error("DEEPSEEK_API_KEY não configurada.");
  return {
    id: requestedModel,
    label: requestedModel === "forza-2-5-thinking" ? "Forza 2.5 Thinking" : "Forza 1.0 Flash",
    provider: "deepseek",
    endpoint: "https://api.deepseek.com/v1/chat/completions",
    upstreamModel: requestedModel === "forza-2-5-thinking" ? "deepseek-reasoner" : "deepseek-chat",
    apiKey: deepSeekKey,
    creditMultiplier: requestedModel === "forza-2-5-thinking" ? 4 : 1,
  };
}

async function fetchAiText(model, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(model.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${model.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({ ...body, model: model.upstreamModel }),
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`O provedor ${model.label} demorou mais de ${Math.round(AI_REQUEST_TIMEOUT_MS / 1000)}s para responder. Esse modelo pode estar congestionado; use um modelo menor/mais rápido para gerar site completo.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Falha no provedor (${response.status}): ${text.slice(0, 240)}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("A IA retornou resposta vazia.");
  return content;
}

async function generateSiteFiles(model, project, userBrief, filesContext, skillsContext) {
  const baseContext = `Projeto: ${project.name} (${project.site_type})\nDescrição: ${project.description ?? "—"}${skillsContext ? `\n\nSKILLS ATIVAS DO PROJETO:\n${skillsContext}` : ""}\n\nArquivos atuais:\n${filesContext}\n\nPedido do usuário:\n${userBrief}`;
  const messages = [
    {
      role: "system",
      content:
        "Você é o ForzaAI, um gerador de sites profissional nível Lovable. Gere um site completo e bonito em UMA resposta. Retorne obrigatoriamente três arquivos, nesta ordem e sem texto extra fora dos arquivos:\n=== index.html ===\n<!doctype html>...\n=== styles.css ===\n...CSS...\n=== script.js ===\n...JS...\nO HTML deve linkar styles.css e script.js, ser mobile-first, semântico, com SEO, acessível e copy em português do Brasil. CSS refinado, moderno, responsivo, com variáveis e Google Fonts. JS puro, seguro e simples. Não faça perguntas em Build: escolha detalhes profissionais coerentes.",
    },
    { role: "user", content: baseContext },
  ];

  const content = await fetchAiText(model, { stream: false, temperature: 0.1, messages });
  const parsed = normalizeGeneratedFiles(content, project.name);
  if (parsed) return parsed;

  const fixed = await fetchAiText(model, {
    stream: false,
    temperature: 0,
    messages: [
      ...messages,
      { role: "assistant", content: content.slice(0, 120_000) },
      {
        role: "user",
        content:
          "Reformate a resposta anterior agora. Não explique nada. Retorne somente:\n=== index.html ===\nHTML completo\n=== styles.css ===\nCSS completo\n=== script.js ===\nJavaScript completo",
      },
    ],
  });
  const repaired = normalizeGeneratedFiles(fixed, project.name);
  if (!repaired) throw new Error("A IA não retornou HTML suficiente para montar o site. Tente novamente com Forza 1.0 Pro ou descreva o site com mais detalhes.");
  return repaired;
}

async function saveFiles(supabase, projectId, files) {
  for (const file of files) {
    const { data: existing, error: lookupError } = await supabase
      .from("project_files")
      .select("id")
      .eq("project_id", projectId)
      .eq("path", file.path)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (existing) {
      const { error } = await supabase.from("project_files").update({
        content: file.content,
        language: file.language,
        updated_at: new Date().toISOString(),
      }).eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("project_files").insert({
        project_id: projectId,
        path: file.path,
        language: file.language,
        content: file.content,
      });
      if (error) throw error;
    }
  }
  const { error } = await supabase.from("projects").update({
    status: "active",
    updated_at: new Date().toISOString(),
  }).eq("id", projectId);
  if (error) throw error;
}

export default async (request) => {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || request.headers.get("x-generation-secret") !== serviceKey) return json(401, { error: "Unauthorized" });

  const { jobId } = await request.json().catch(() => ({}));
  if (!jobId) return json(400, { error: "Missing jobId" });

  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) return json(500, { error: "SUPABASE_URL missing" });
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    await updateJob(supabase, jobId, { status: "running", stage: "Carregando projeto…" });
    const { data: job, error: jobError } = await supabase
      .from("generation_jobs")
      .select("id, project_id, user_id, model_id, message")
      .eq("id", jobId)
      .single();
    if (jobError || !job) throw jobError ?? new Error("Job não encontrado");

    const { data: hasSubscription } = await supabase.rpc("has_active_subscription", { _user_id: job.user_id });
    const model = await routeModel(supabase, job.model_id, Boolean(hasSubscription));

    const creditCost = Math.ceil(model.creditMultiplier || 1);

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, name, site_type, description")
      .eq("id", job.project_id)
      .single();
    if (projectError || !project) throw projectError ?? new Error("Projeto não encontrado");

    await updateJob(supabase, jobId, { stage: `Gerando com ${model.label}…` });
    const { data: currentFiles } = await supabase.from("project_files").select("path, content").eq("project_id", job.project_id);
    const filesContext = (currentFiles ?? []).map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n") || "(sem arquivos ainda)";
    const { data: skillsData } = await supabase.from("project_skill_activations").select("ai_skills(name, description, prompt)").eq("project_id", job.project_id);
    const skillsContext = (skillsData ?? []).map((row) => row.ai_skills).filter(Boolean).map((skill) => `Skill: ${skill.name}\nDescrição: ${skill.description}\nInstrução: ${skill.prompt}`).join("\n\n");

    const files = await generateSiteFiles(model, project, job.message, filesContext, skillsContext);
    await updateJob(supabase, jobId, { stage: "Salvando arquivos…" });
    await saveFiles(supabase, job.project_id, files);

    const { data: debited, error: debitError } = await supabase.rpc("debit_project_owner_credits", {
      _project_id: job.project_id,
      _amount: creditCost,
      _description: `${model.label} no projeto em background`,
    });
    if (debitError) throw debitError;
    if (!debited) throw new Error("Créditos insuficientes do dono do projeto.");

    let { data: convo } = await supabase.from("conversations").select("id").eq("project_id", job.project_id).order("created_at").limit(1).maybeSingle();
    if (!convo) {
      const { data: created, error } = await supabase.from("conversations").insert({ project_id: job.project_id, title: "Conversa principal" }).select("id").single();
      if (error) throw error;
      convo = created;
    }
    await supabase.from("messages").insert({ conversation_id: convo.id, role: "assistant", content: "Pronto — gerei seu site completo em background." });

    await updateJob(supabase, jobId, {
      status: "completed",
      stage: "Concluído",
      files_updated: files.length,
      completed_at: new Date().toISOString(),
    });
    return json(200, { ok: true });
  } catch (error) {
    console.error("[background generation] failed", error);
    await updateJob(supabase, jobId, {
      status: "failed",
      stage: "Falhou",
      error: error instanceof Error ? error.message : String(error),
      completed_at: new Date().toISOString(),
    });
    return json(500, { error: error instanceof Error ? error.message : String(error) });
  }
};

export const config = { type: "background" };
