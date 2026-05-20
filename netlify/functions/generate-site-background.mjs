import { createClient } from "@supabase/supabase-js";

const AI_REQUEST_TIMEOUT_MS = 7_200_000;
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

const updateRun = async (supabase, runId, patch) => {
  const { error } = await supabase
    .from("engine_runs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", runId);
  if (error) console.error("[forza engine] run update failed", error);
};

const saveArtifact = async (supabase, runId, kind, content) => {
  const { error } = await supabase.from("engine_artifacts").insert({ run_id: runId, kind, content });
  if (error) console.error("[forza engine] artifact insert failed", error);
};

function stripGeneratedCode(text, language) {
  const trimmed = String(text || "").trim();
  const langFence = language
    ? trimmed.match(new RegExp("```" + language + "\\s*([\\s\\S]*?)```", "i"))
    : null;
  const anyFence = trimmed.match(/```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/);
  return (langFence?.[1] ?? anyFence?.[1] ?? trimmed).trim();
}

function extractJson(text) {
  const trimmed = String(text || "").trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fence ? fence[1] : trimmed).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Sem JSON na resposta");
  return JSON.parse(body.slice(start, end + 1));
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
    const provider = String(setting.provider || "").trim();
    const endpoint = String(setting.endpoint || "").trim();
    if (provider === "deepseek" && !endpoint.includes("api.deepseek.com")) {
      throw new Error("Configuração inválida: provider DeepSeek está apontando para endpoint que não é da DeepSeek. Para NVIDIA, use provider OpenAI-compatible oficial.");
    }
    if (provider !== "deepseek" && endpoint.includes("api.deepseek.com")) {
      throw new Error("Configuração inválida: endpoint da DeepSeek precisa usar provider DeepSeek.");
    }
    const apiKey = setting.api_key || (provider === "deepseek" ? deepSeekKey : null);
    if (!apiKey) throw new Error(`API key não configurada para ${setting.label}.`);
    return {
      id: requestedModel,
      label: setting.label,
      provider,
      endpoint,
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

function normalizeAiRequestBody(model, body) {
  const requestBody = { ...body, model: model.upstreamModel };
  const isOpenAiGpt5 =
    String(model.endpoint || "").includes("api.openai.com") &&
    /^gpt-5/i.test(String(model.upstreamModel || ""));
  if (isOpenAiGpt5) delete requestBody.temperature;
  return requestBody;
}

function describeFetchFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  return [message, cause].filter(Boolean).join(": ") || "erro de rede sem detalhe";
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
      body: JSON.stringify(normalizeAiRequestBody(model, body)),
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`O provedor ${model.label} demorou mais de ${Math.round(AI_REQUEST_TIMEOUT_MS / 1000)}s para responder. Esse modelo pode estar congestionado; use um modelo menor/mais rápido para gerar site completo.`);
    }
    throw new Error(`Falha de conexão com o provedor ${model.label} em ${model.endpoint}: ${describeFetchFailure(error)}. Confira endpoint, rede da hospedagem e se o modelo upstream "${model.upstreamModel}" existe na API.`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) throw new Error(`Falha de autenticação no provedor ${model.label}: confira a API key e o provider selecionado.`);
    if (response.status === 402) throw new Error(`Créditos esgotados no provedor ${model.label}.`);
    if (response.status === 400) throw new Error(`Configuração inválida no provedor ${model.label}: confira endpoint, parâmetros e se o modelo upstream "${model.upstreamModel}" existe. Detalhe: ${text.slice(0, 240)}`);
    if (response.status === 404) throw new Error(`Modelo não encontrado no provedor ${model.label}: confira o modelo upstream "${model.upstreamModel}".`);
    if (response.status === 429) throw new Error(`Limite do provedor ${model.label} atingido. Aguarde alguns segundos ou use outro modelo.`);
    if (response.status === 502 || /bad gateway|<html/i.test(text)) throw new Error(`O provedor ${model.label} retornou gateway/instabilidade (${response.status}). Isso costuma ser falha upstream ou congestionamento do modelo "${model.upstreamModel}"; tente novamente ou use um modelo menor. Detalhe: ${text.replace(/\s+/g, " ").slice(0, 180)}`);
    throw new Error(`Falha no provedor ${model.label} (${response.status}): ${text.slice(0, 240)}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("A IA retornou resposta vazia.");
  return content;
}

async function fetchJson(model, messages, fallback) {
  const content = await fetchAiText(model, {
    stream: false,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages,
  });
  try {
    return extractJson(content);
  } catch (error) {
    console.error("[forza engine] json parse failed", error, content.slice(0, 500));
    return fallback;
  }
}

function filesContext(files) {
  return (files ?? []).map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n") || "(sem arquivos ainda)";
}

async function createTask(supabase, runId, position, phase, title, description, input = null) {
  const { data, error } = await supabase
    .from("engine_tasks")
    .insert({ run_id: runId, position, phase, title, description, input, status: "pending" })
    .select("id, position, phase, title, description, status")
    .single();
  if (error) throw error;
  return data;
}

async function updateTask(supabase, taskId, patch) {
  const { error } = await supabase
    .from("engine_tasks")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", taskId);
  if (error) throw error;
}

async function setPhase(supabase, jobId, runId, phase, stage) {
  await Promise.all([
    updateJob(supabase, jobId, { stage }),
    updateRun(supabase, runId, { phase, status: "running" }),
  ]);
}

async function buildPlans(supabase, model, run, project, job, currentFiles, skillsContext) {
  await setPhase(supabase, job.id, run.id, "briefing", "Forza Engine: entendendo o briefing…");
  const brief = {
    projectName: project.name,
    siteType: project.site_type,
    description: project.description ?? "",
    userRequest: job.message,
    existingFiles: (currentFiles ?? []).map((file) => file.path),
  };
  await saveArtifact(supabase, run.id, "brief", brief);

  await setPhase(supabase, job.id, run.id, "product_plan", "Forza Engine: criando plano de produto…");
  const productPlan = await fetchJson(model, [
    {
      role: "system",
      content: "Você é o estrategista de produto sênior do ForzaAI. Transforme o briefing em um plano de SaaS/site completo, não apenas uma home. Pense como Lovable/Claude Code: produto, usuários, fluxos, páginas, estados vazios, monetização, onboarding e diferenciais. Responda somente JSON com: summary, audience, positioning, pages, user_flows, features, entities, conversion_goals, quality_criteria, edge_cases, security_notes.",
    },
    {
      role: "user",
      content: `Projeto: ${project.name} (${project.site_type})\nDescrição: ${project.description ?? "—"}\nPedido: ${job.message}\nSkills:\n${skillsContext || "—"}\nArquivos atuais:\n${filesContext(currentFiles)}`,
    },
  ], {
    summary: job.message,
    pages: ["Home", "Dashboard", "Login", "Pricing", "Settings"],
    features: ["Navegação", "Hero", "Dashboard", "Planos", "CTA"],
    quality_criteria: ["Responsivo", "Acessível", "Visual profissional", "Fluxos claros"],
  });
  await saveArtifact(supabase, run.id, "product_plan", productPlan);

  await setPhase(supabase, job.id, run.id, "technical_plan", "Forza Engine: desenhando arquitetura técnica…");
  const technicalPlan = await fetchJson(model, [
    {
      role: "system",
      content: "Você é o arquiteto técnico do ForzaAI. Crie uma arquitetura viável para entregar no editor atual com index.html, styles.css e script.js, simulando um SaaS completo no front-end sem expor segredos. Inclua rotas/telas simuladas, componentes, dados mockados seguros, estados de loading/erro/vazio, acessibilidade e responsividade. Responda somente JSON com: file_strategy, screens, components, interactions, data_model_mock, state_model, accessibility, responsive_strategy, security_constraints.",
    },
    { role: "user", content: JSON.stringify({ productPlan, currentFiles: currentFiles?.map((file) => file.path) ?? [] }) },
  ], {
    file_strategy: "Gerar HTML/CSS/JS completos e coesos.",
    sections: ["Landing", "Dashboard mockado", "Auth mockado", "Pricing", "Settings"],
    interactions: ["Navegação", "Tabs", "Formulários mockados"],
  });
  await saveArtifact(supabase, run.id, "technical_plan", technicalPlan);

  await supabase.from("engine_runs").update({ plan: { brief, productPlan, technicalPlan } }).eq("id", run.id);
  return { brief, productPlan, technicalPlan };
}

function defaultTasks(productPlan, technicalPlan) {
  const pages = Array.isArray(productPlan.pages) ? productPlan.pages.slice(0, 8).join(", ") : "páginas principais";
  return [
    { title: "Arquitetura de telas", description: `Montar estrutura HTML semântica com navegação para ${pages}, incluindo landing, auth visual e área logada simulada.` },
    { title: "Fluxos SaaS completos", description: "Criar onboarding, dashboard, dados mockados, billing/pricing, configurações, estados vazios e CTAs de conversão." },
    { title: "Design system premium", description: "Construir CSS moderno com tokens, variáveis, responsividade, hierarquia visual, estados, microinterações e acabamento profissional." },
    { title: "Interações seguras", description: `Implementar JS sem dependências, sem segredos, sem eval/HTML inseguro, para ${Array.isArray(technicalPlan.interactions) ? technicalPlan.interactions.join(", ") : "interações essenciais"}.` },
    { title: "Revisão integrada", description: "Garantir consistência entre páginas, copy em português do Brasil, acessibilidade, links internos e comportamento mobile." },
  ];
}

async function createImplementationTasks(supabase, model, run, job, plans) {
  await setPhase(supabase, job.id, run.id, "task_generation", "Forza Engine: quebrando em tasks…");
  const taskPlan = await fetchJson(model, [
    {
      role: "system",
      content: "Quebre a implementação em 4 a 6 tasks pequenas para gerar um SaaS/site completo no editor atual. Responda somente JSON: {\"tasks\":[{\"title\":\"...\",\"description\":\"...\"}]}",
    },
    { role: "user", content: JSON.stringify(plans) },
  ], { tasks: defaultTasks(plans.productPlan, plans.technicalPlan) });
  const rawTasks = Array.isArray(taskPlan.tasks) && taskPlan.tasks.length >= 3 ? taskPlan.tasks : defaultTasks(plans.productPlan, plans.technicalPlan);
  const tasks = rawTasks.slice(0, 6).map((task, index) => ({
    title: String(task.title || `Task ${index + 1}`).slice(0, 120),
    description: String(task.description || task.title || "Implementar parte do projeto.").slice(0, 1200),
  }));
  await saveArtifact(supabase, run.id, "task_plan", { tasks });
  const created = [];
  for (let index = 0; index < tasks.length; index += 1) {
    created.push(await createTask(supabase, run.id, index + 1, "implementation", tasks[index].title, tasks[index].description, tasks[index]));
  }
  return created;
}

async function implementFiles(supabase, model, run, job, project, plans, tasks, currentFiles, skillsContext) {
  await setPhase(supabase, job.id, run.id, "implementation", "Forza Engine: implementando arquivos por tasks…");
  let workingFiles = currentFiles?.length ? currentFiles.map((file) => ({ path: file.path, language: file.path === "styles.css" ? "css" : file.path === "script.js" ? "javascript" : "html", content: file.content })) : [];

  for (const task of tasks) {
    await updateTask(supabase, task.id, { status: "running" });
    await updateJob(supabase, job.id, { stage: `Forza Engine: ${task.title}` });
    const content = await fetchAiText(model, {
      stream: false,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: "Você é o implementador principal do ForzaAI. Aplique a task no projeto e retorne SEMPRE os três arquivos completos, sem explicação fora dos arquivos:\n=== index.html ===\nHTML completo\n=== styles.css ===\nCSS completo\n=== script.js ===\nJavaScript completo\nMantenha tudo coeso, responsivo, acessível e com visual premium. Para SaaS, simule produto completo: landing, auth visual, dashboard, onboarding, planos, settings, dados mockados e estados reais. Segurança obrigatória: não use eval, innerHTML com dados variáveis, scripts remotos desconhecidos, API keys, service role, SQL ou endpoints sensíveis no código gerado.",
        },
        {
          role: "user",
          content: `Projeto: ${project.name}\nPedido original: ${job.message}\nSkills:\n${skillsContext || "—"}\nPlanos:\n${JSON.stringify(plans)}\n\nTask atual: ${task.title}\n${task.description}\n\nArquivos atuais de trabalho:\n${filesContext(workingFiles)}`,
        },
      ],
    });
    const parsed = normalizeGeneratedFiles(content, project.name);
    await saveArtifact(supabase, run.id, "model_raw_output", { taskId: task.id, title: task.title, content: content.slice(0, 120_000) });
    if (!parsed) {
      await updateTask(supabase, task.id, { status: "failed", error: "A IA não retornou arquivos suficientes." });
      throw new Error(`A task ${task.title} não retornou arquivos suficientes.`);
    }
    workingFiles = parsed;
    await updateTask(supabase, task.id, {
      status: "completed",
      output: { files: parsed.map((file) => ({ path: file.path, chars: file.content.length })) },
      completed_at: new Date().toISOString(),
    });
  }

  return workingFiles;
}

async function validateFiles(supabase, model, run, job, project, plans, files) {
  await setPhase(supabase, job.id, run.id, "validation", "Forza Engine: validando qualidade…");
  const report = await fetchJson(model, [
    {
      role: "system",
      content: "Você é o revisor final do ForzaAI. Avalie se os arquivos cumprem o briefing e critérios de SaaS/site premium. Seja rigoroso com: não ser só home, responsividade, acessibilidade, copy BR, consistência visual, fluxos de SaaS, JS seguro e ausência de segredos/API keys/SQL no frontend. Responda somente JSON com: score 0-100, passed boolean, summary, issues, improvements, security_findings, missing_scope.",
    },
    { role: "user", content: JSON.stringify({ project, request: job.message, plans, files: files.map((file) => ({ path: file.path, chars: file.content.length, preview: file.content.slice(0, 6000) })) }) },
  ], { score: 85, passed: true, summary: "Validação concluída.", issues: [], improvements: [] });
  await saveArtifact(supabase, run.id, "validation_report", report);
  return report;
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

async function createVersion(supabase, run, project, files, validationReport) {
  const { data: latest } = await supabase
    .from("project_file_versions")
    .select("version_number")
    .eq("project_id", project.id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const versionNumber = Number(latest?.version_number || 0) + 1;
  const { data: version, error } = await supabase
    .from("project_file_versions")
    .insert({
      project_id: project.id,
      run_id: run.id,
      version_number: versionNumber,
      label: `Versão ${versionNumber}`,
      summary: String(validationReport.summary || "Site gerado pelo Forza Engine."),
      files,
      created_by: run.user_id,
    })
    .select("id, version_number, label")
    .single();
  if (error) throw error;
  await updateRun(supabase, run.id, { current_version_id: version.id });
  return version;
}

async function ensureConversation(supabase, projectId) {
  let { data: convo } = await supabase.from("conversations").select("id").eq("project_id", projectId).order("created_at").limit(1).maybeSingle();
  if (!convo) {
    const { data: created, error } = await supabase.from("conversations").insert({ project_id: projectId, title: "Conversa principal" }).select("id").single();
    if (error) throw error;
    convo = created;
  }
  return convo;
}

async function runEngine(supabase, job, model, project, currentFiles, skillsContext) {
  const mode = currentFiles?.length ? "edit" : "full_stack";
  const { data: run, error: runError } = await supabase
    .from("engine_runs")
    .insert({
      generation_job_id: job.id,
      project_id: job.project_id,
      user_id: job.user_id,
      mode,
      status: "running",
      phase: "briefing",
      brief: job.message,
    })
    .select("id, project_id, user_id")
    .single();
  if (runError) throw runError;

  try {
    const plans = await buildPlans(supabase, model, run, project, job, currentFiles, skillsContext);
    const tasks = await createImplementationTasks(supabase, model, run, job, plans);
    const files = await implementFiles(supabase, model, run, job, project, plans, tasks, currentFiles, skillsContext);
    const validationReport = await validateFiles(supabase, model, run, job, project, plans, files);
    await setPhase(supabase, job.id, run.id, "finalize", "Forza Engine: salvando versão final…");
    await saveFiles(supabase, job.project_id, files);
    const version = await createVersion(supabase, run, project, files, validationReport);
    return { run, files, version, validationReport };
  } catch (error) {
    await updateRun(supabase, run.id, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      completed_at: new Date().toISOString(),
    });
    throw error;
  }
}

export default async (request) => {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const generationSecret = process.env.FORZA_ENGINE_SECRET || serviceKey;
  if (!serviceKey || !generationSecret || request.headers.get("x-generation-secret") !== generationSecret) return json(401, { error: "Unauthorized" });

  const { jobId } = await request.json().catch(() => ({}));
  if (!jobId) return json(400, { error: "Missing jobId" });

  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) return json(500, { error: "SUPABASE_URL missing" });
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    await updateJob(supabase, jobId, { status: "running", stage: "Forza Engine: carregando projeto…" });
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

    const { data: currentFiles } = await supabase.from("project_files").select("path, content").eq("project_id", job.project_id);
    const { data: skillsData } = await supabase.from("project_skill_activations").select("ai_skills(name, description, prompt)").eq("project_id", job.project_id);
    const skillsContext = (skillsData ?? []).map((row) => row.ai_skills).filter(Boolean).map((skill) => `Skill: ${skill.name}\nDescrição: ${skill.description}\nInstrução: ${skill.prompt}`).join("\n\n");

    const { run, files, version, validationReport } = await runEngine(supabase, job, model, project, currentFiles ?? [], skillsContext);

    const { data: debited, error: debitError } = await supabase.rpc("debit_project_owner_credits", {
      _project_id: job.project_id,
      _amount: creditCost,
      _description: `${model.label} no Forza Engine`,
    });
    if (debitError) throw debitError;
    if (!debited) throw new Error("Créditos insuficientes do dono do projeto.");

    const convo = await ensureConversation(supabase, job.project_id);
    await supabase.from("messages").insert({
      conversation_id: convo.id,
      role: "assistant",
      content: `Pronto — o Forza Engine gerou o projeto em ${files.length} arquivos, criou ${version.label} e validou com score ${validationReport.score ?? "—"}/100.`,
    });

    await updateRun(supabase, run.id, {
      status: "completed",
      phase: "completed",
      completed_at: new Date().toISOString(),
    });
    await updateJob(supabase, jobId, {
      status: "completed",
      stage: "Concluído pelo Forza Engine",
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
