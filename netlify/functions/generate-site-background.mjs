import { createClient } from "@supabase/supabase-js";

const AI_REQUEST_TIMEOUT_MS = 240_000;
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
  const re = new RegExp(`===\\s*${escaped}\\s*===\\s*([\\s\\S]*?)(?=\\n===\\s*(?:index\\.html|styles\\.css|script\\.js)\\s*===|$)`, "i");
  const language = path === "index.html" ? "html" : path === "styles.css" ? "css" : "javascript";
  return stripGeneratedCode(text.match(re)?.[1] ?? "", language).trim();
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
  const content = await fetchAiText(model, {
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
  if (!html || !css || !js) throw new Error("A IA não retornou os 3 arquivos no formato correto.");

  if (!/<html[\s>]/i.test(html)) {
    html = `<!doctype html>\n<html lang="pt-BR">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>${project.name}</title>\n  <link rel="stylesheet" href="styles.css" />\n</head>\n<body>\n${html}\n  <script src="script.js"></script>\n</body>\n</html>`;
  }
  if (!/styles\.css/i.test(html)) html = html.replace(/<\/head>/i, '  <link rel="stylesheet" href="styles.css" />\n</head>');
  if (!/script\.js/i.test(html)) html = html.replace(/<\/body>/i, '  <script src="script.js"></script>\n</body>');

  return [
    { path: "index.html", language: "html", content: html },
    { path: "styles.css", language: "css", content: css },
    { path: "script.js", language: "javascript", content: js },
  ];
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
    const { data: debited, error: debitError } = await supabase.rpc("debit_project_owner_credits", {
      _project_id: job.project_id,
      _amount: creditCost,
      _description: `${model.label} no projeto em background`,
    });
    if (debitError) throw debitError;
    if (!debited) throw new Error("Créditos insuficientes do dono do projeto.");

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
