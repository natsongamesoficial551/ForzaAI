import { createClient } from "@supabase/supabase-js";
import { Agent } from "undici";

const AI_REQUEST_TIMEOUT_MS = 7_200_000;
const AI_FETCH_DISPATCHER = new Agent({
  connect: { timeout: 120_000 },
  headersTimeout: AI_REQUEST_TIMEOUT_MS,
  bodyTimeout: AI_REQUEST_TIMEOUT_MS,
});
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

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

function deliveryContract(project, job, plans) {
  const request = job.message || project.description || project.name || "site premium";
  const productPlan = plans?.productPlan ?? {};
  const technicalPlan = plans?.technicalPlan ?? {};
  return {
    original_request: request,
    project_name: project.name,
    site_type: project.site_type,
    must_preserve: [
      "O pedido original é a fonte da verdade e deve aparecer em todas as decisões de produto, telas, copy e validação.",
      "A entrega final sempre precisa conter index.html, styles.css e script.js completos e coerentes entre si.",
      "Cada task deve expandir o produto inteiro, não substituir o projeto por um recorte menor da task atual.",
      "O resultado deve parecer um produto/site final premium, não scaffold, placeholder, wireframe ou home genérica.",
    ],
    required_sections: productPlan.pages ?? technicalPlan.screens ?? ["Landing", "Onboarding", "Dashboard", "Pricing", "Settings", "Contato"],
    required_features: productPlan.features ?? ["Navegação", "CTAs", "Dados mockados", "Estados vazios", "Responsividade", "Interações seguras"],
    acceptance_criteria: [
      ...(productPlan.quality_criteria ?? []),
      "Visual premium com hierarquia, espaçamento, responsividade e microinterações.",
      "Copy específica do briefing em português do Brasil.",
      "Sem TODO, lorem ipsum, placeholders, segredos, SQL sensível, service role, API keys ou eval.",
      "CSS com media queries e componentes suficientes para desktop/mobile.",
      "JS seguro para navegação/interações sem innerHTML com dados variáveis.",
      "Todo botão, formulário, tab, filtro, carrinho, modal, FAQ, toggle claro/escuro ou menu visível precisa ter comportamento funcional seguro no script.js.",
      "Formulários devem validar campos e exibir feedback de sucesso/erro sem enviar dados reais.",
    ],
  };
}

function deterministicPremiumFiles(project, job, plans, reason = []) {
  const title = escapeHtml(project.name || "Projeto ForzaAI");
  const request = escapeHtml(job.message || project.description || project.name || "site premium");
  const lowerRequest = String(job.message || project.name || "").toLowerCase();
  const isPortfolio = /portfolio|portfólio|designer|freelancer|criativo/.test(lowerRequest);
  const isSaas = /saas|software|pricing|dashboard|login|billing|assinatura|crm|app/.test(lowerRequest);
  const primaryLabel = isPortfolio ? "Ver projetos" : isSaas ? "Começar teste grátis" : "Solicitar proposta";
  const secondaryLabel = isPortfolio ? "Falar comigo" : isSaas ? "Ver pricing" : "Conhecer solução";
  const modules = isPortfolio
    ? ["Identidade visual", "UX/UI para produtos digitais", "Landing pages premium", "Design systems", "Cases com métricas", "Contato estratégico"]
    : isSaas
      ? ["Landing de conversão", "Pricing com planos", "Onboarding guiado", "Dashboard com métricas", "Settings e billing", "Dados mockados seguros"]
      : ["Oferta clara", "Prova social", "Seções comerciais", "FAQ", "CTA recorrente", "Responsividade completa"];
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="site-header">
    <nav class="nav-shell" aria-label="Navegação principal">
      <a class="brand" href="#topo" aria-label="${title}"><span>${title.slice(0, 1)}</span>${title}</a>
      <div class="nav-links">
        <a href="#solucao">Solução</a>
        <a href="#projetos">${isPortfolio ? "Projetos" : "Produto"}</a>
        <a href="#pricing">Pricing</a>
        <a href="#contato">Contato</a>
      </div>
      <a class="nav-cta" href="#contato">${primaryLabel}</a>
    </nav>
  </header>
  <main id="topo">
    <section class="hero section-grid">
      <div class="hero-copy reveal">
        <p class="eyebrow">Experiência premium</p>
        <h1>${title}: uma experiência premium para ${request}</h1>
        <p class="hero-lead">Página completa, responsiva e orientada à conversão, com narrativa clara, visual moderno, prova social, pricing e fluxos simulados para validar a ideia com segurança.</p>
        <div class="hero-actions">
          <a class="button primary" href="#contato">${primaryLabel}</a>
          <a class="button ghost" href="#pricing">${secondaryLabel}</a>
        </div>
        <ul class="trust-list" aria-label="Diferenciais">
          <li>Mobile-first</li><li>Copy brasileira</li><li>Visual premium</li><li>Dados seguros</li>
        </ul>
      </div>
      <aside class="hero-panel reveal" aria-label="Preview do produto">
        <div class="panel-top"><span></span><span></span><span></span></div>
        <div class="metric-card strong"><small>Conversão estimada</small><strong>+38%</strong><em>com CTA e prova social consistentes</em></div>
        <div class="mini-grid">
          <div><strong>12</strong><small>Seções</small></div><div><strong>3</strong><small>Planos</small></div><div><strong>100%</strong><small>Responsivo</small></div>
        </div>
        <div class="chart-bars"><i></i><i></i><i></i><i></i><i></i></div>
      </aside>
    </section>
    <section id="solucao" class="section-block">
      <div class="section-heading"><p class="eyebrow">Estratégia</p><h2>Estrutura pensada para transformar visitantes em leads qualificados.</h2><p>O layout organiza mensagem, benefícios, diferenciais, prova social e CTA em uma jornada simples de entender e fácil de agir.</p></div>
      <div class="cards-grid">${modules.map((item, index) => `<article class="feature-card reveal"><span>0${index + 1}</span><h3>${item}</h3><p>${isPortfolio ? "Mostra valor profissional com clareza, estética e contexto de negócio para cada case." : "Ajuda o visitante a entender rapidamente o valor e avançar para o próximo passo."}</p></article>`).join("")}</div>
    </section>
    <section id="projetos" class="showcase section-grid">
      <div><p class="eyebrow">Experiência</p><h2>${isPortfolio ? "Cases com narrativa, processo e resultado." : "Produto demonstrável antes da integração final."}</h2><p>Cada bloco usa dados demonstrativos para mostrar fluxos reais com uma interface pronta para evoluir para integrações server-side.</p></div>
      <div class="workspace-card">
        <div class="tabs"><button class="active" type="button">Visão geral</button><button type="button">Métricas</button><button type="button">Configuração</button></div>
        <div class="workspace-content"><h3>${isPortfolio ? "Case: redesign de marca SaaS" : "Dashboard do cliente"}</h3><p>Visão de métricas, status e próximos passos em uma interface limpa e objetiva.</p><div class="progress"><span style="width:76%"></span></div><div class="task-list"><p>Briefing validado</p><p>Identidade aplicada</p><p>Fluxo responsivo aprovado</p></div></div>
      </div>
    </section>
    <section class="social-proof section-block">
      <div class="quote-card"><p>“A proposta ficou clara em poucos segundos. Visual forte, estrutura objetiva e CTAs no lugar certo.”</p><strong>Cliente beta</strong><span>Validação de produto digital</span></div>
      <div class="stats-grid"><div><strong>4.9/5</strong><span>Satisfação</span></div><div><strong>7 dias</strong><span>Para validar</span></div><div><strong>24h</strong><span>Para iterar</span></div></div>
    </section>
    <section id="pricing" class="section-block pricing-section">
      <div class="section-heading"><p class="eyebrow">Pricing</p><h2>Planos claros para remover fricção na decisão.</h2><p>Estrutura pronta para simular assinatura, proposta ou pacotes de serviço.</p></div>
      <div class="pricing-grid">
        <article class="price-card"><h3>Starter</h3><strong>R$ 49</strong><p>Para validar a primeira oferta.</p><ul><li>Landing completa</li><li>CTA principal</li><li>FAQ essencial</li></ul><a href="#contato">Escolher Starter</a></article>
        <article class="price-card featured"><h3>Pro</h3><strong>R$ 149</strong><p>Para produto com prova social e funil.</p><ul><li>Pricing avançado</li><li>Dashboard mockado</li><li>Onboarding visual</li></ul><a href="#contato">Escolher Pro</a></article>
        <article class="price-card"><h3>Enterprise</h3><strong>Custom</strong><p>Para operação com integrações futuras.</p><ul><li>Blueprint técnico</li><li>Integrações planejadas</li><li>Fluxos multiusuário</li></ul><a href="#contato">Falar com vendas</a></article>
      </div>
    </section>
    <section class="faq section-block"><div class="section-heading"><p class="eyebrow">FAQ</p><h2>Perguntas que reduzem objeções.</h2></div><div class="faq-list"><details open><summary>Isso já conecta pagamentos reais?</summary><p>Não nesta etapa. O preview simula a experiência e deixa integrações como manifesto seguro para backend controlado.</p></details><details><summary>Funciona no celular?</summary><p>Sim, o CSS usa layout fluido, grid responsivo e media queries para telas menores.</p></details><details><summary>Tem dados sensíveis no código?</summary><p>Não. O preview usa dados demonstrativos e deixa integrações reais para uma camada server-side controlada.</p></details></div></section>
    <section id="contato" class="cta-section"><p class="eyebrow">Próximo passo</p><h2>Pronto para transformar essa ideia em uma página publicável?</h2><p>Use este preview como base visual e evolua com ajustes de copy, integrações seguras e backend quando necessário.</p><form class="lead-form"><input aria-label="Nome" value="" /><input aria-label="Email" value="" /><button type="submit">${primaryLabel}</button></form></section>
  </main>
  <footer class="site-footer"><p>${title} — experiência digital pronta para validação.</p><a href="#topo">Voltar ao topo</a></footer>
  <script src="script.js"></script>
</body>
</html>`;
  const css = `:root{color-scheme:dark;--bg:#08070d;--surface:#11101a;--surface-2:#181626;--text:#f8f4e8;--muted:#bdb4a4;--line:rgba(255,255,255,.12);--primary:#8b5cf6;--primary-2:#c084fc;--accent:#f6c66b;--good:#34d399;--shadow:0 24px 80px rgba(0,0,0,.38);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at top left,rgba(139,92,246,.22),transparent 34rem),radial-gradient(circle at 85% 10%,rgba(246,198,107,.12),transparent 28rem),var(--bg);color:var(--text)}a{color:inherit;text-decoration:none}button,input{font:inherit}.site-header{position:sticky;top:0;z-index:10;background:rgba(8,7,13,.76);backdrop-filter:blur(18px);border-bottom:1px solid var(--line)}.nav-shell{width:min(1180px,calc(100% - 32px));margin:auto;height:76px;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{display:flex;align-items:center;gap:10px;font-weight:900;letter-spacing:-.04em}.brand span{display:grid;place-items:center;width:38px;height:38px;border-radius:14px;background:linear-gradient(135deg,var(--primary),var(--accent));color:#120d1f}.nav-links{display:flex;gap:22px;color:var(--muted);font-size:14px}.nav-links a:hover{color:var(--text)}.nav-cta,.button,.price-card a,.lead-form button{border:0;border-radius:999px;padding:13px 18px;font-weight:800;background:linear-gradient(135deg,var(--primary),var(--primary-2));color:white;box-shadow:0 14px 34px rgba(139,92,246,.28);cursor:pointer}.section-grid{width:min(1180px,calc(100% - 32px));margin:auto;display:grid;grid-template-columns:1.05fr .95fr;gap:42px;align-items:center;scroll-margin-top:96px}.hero{min-height:auto;padding:72px 0 84px}.eyebrow{margin:0 0 12px;color:var(--accent);font-weight:900;text-transform:uppercase;letter-spacing:.14em;font-size:12px}.hero h1,.section-heading h2,.showcase h2,.cta-section h2{margin:0;color:var(--text);font-size:clamp(36px,5vw,68px);line-height:1.04;letter-spacing:-.055em;overflow-wrap:anywhere}.section-heading h2,.showcase h2,.cta-section h2{font-size:clamp(30px,3.6vw,50px)}.hero-lead,.section-heading p,.showcase p,.cta-section p{color:var(--muted);font-size:18px;line-height:1.75;max-width:760px}.hero-actions{display:flex;gap:14px;flex-wrap:wrap;margin:30px 0}.button.ghost{background:rgba(255,255,255,.08);border:1px solid var(--line);box-shadow:none}.trust-list{display:flex;gap:12px;flex-wrap:wrap;padding:0;margin:0;list-style:none}.trust-list li{border:1px solid var(--line);background:rgba(255,255,255,.06);border-radius:999px;padding:9px 12px;color:var(--muted);font-size:13px}.hero-panel,.workspace-card,.quote-card,.price-card,.feature-card{border:1px solid var(--line);background:linear-gradient(180deg,rgba(255,255,255,.09),rgba(255,255,255,.04));border-radius:32px;box-shadow:var(--shadow)}.hero-panel{padding:24px;min-height:470px}.panel-top{display:flex;gap:8px;margin-bottom:22px}.panel-top span{width:12px;height:12px;border-radius:50%;background:var(--line)}.metric-card{padding:24px;border-radius:24px;background:rgba(255,255,255,.07);display:grid;gap:8px}.metric-card small,.mini-grid small,.quote-card span,.stats-grid span{color:var(--muted)}.metric-card strong{font-size:62px;letter-spacing:-.08em}.metric-card em{color:var(--good);font-style:normal}.mini-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:18px 0}.mini-grid div,.stats-grid div{padding:18px;border-radius:20px;background:rgba(255,255,255,.06);border:1px solid var(--line)}.mini-grid strong,.stats-grid strong{display:block;font-size:28px}.chart-bars{height:150px;display:flex;align-items:end;gap:12px;padding:18px;background:rgba(255,255,255,.05);border-radius:24px}.chart-bars i{flex:1;border-radius:16px 16px 4px 4px;background:linear-gradient(180deg,var(--accent),var(--primary));min-height:42px}.chart-bars i:nth-child(2){height:70%}.chart-bars i:nth-child(3){height:46%}.chart-bars i:nth-child(4){height:88%}.chart-bars i:nth-child(5){height:62%}.section-block{width:min(1180px,calc(100% - 32px));margin:0 auto 84px;scroll-margin-top:96px}.section-heading{margin-bottom:28px}.cards-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.feature-card{padding:24px}.feature-card span{color:var(--accent);font-weight:900}.feature-card h3{font-size:22px;letter-spacing:-.04em}.feature-card p,.price-card p,.price-card li,.faq p{color:var(--muted);line-height:1.65}.showcase{margin-bottom:84px}.workspace-card{padding:22px}.tabs{display:flex;gap:10px;margin-bottom:18px}.tabs button{border:1px solid var(--line);background:transparent;color:var(--muted);padding:10px 12px;border-radius:999px}.tabs .active{background:rgba(139,92,246,.25);color:white}.workspace-content{background:rgba(0,0,0,.18);border-radius:24px;padding:24px}.progress{height:12px;border-radius:999px;background:rgba(255,255,255,.1);overflow:hidden}.progress span{display:block;height:100%;background:linear-gradient(90deg,var(--good),var(--accent));border-radius:inherit}.task-list{display:grid;gap:10px;margin-top:18px}.task-list p{margin:0;padding:12px;border:1px solid var(--line);border-radius:14px}.social-proof{display:grid;grid-template-columns:1fr 1fr;gap:18px}.quote-card{padding:28px}.quote-card p{font-size:24px;line-height:1.35}.stats-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.pricing-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.price-card{padding:26px;display:grid;gap:14px}.price-card.featured{outline:2px solid rgba(246,198,107,.42);transform:translateY(-10px)}.price-card strong{font-size:44px;letter-spacing:-.06em}.price-card ul{padding-left:18px}.faq-list{display:grid;gap:12px}.faq details{border:1px solid var(--line);border-radius:22px;padding:18px;background:rgba(255,255,255,.05)}.faq summary{cursor:pointer;font-weight:800}.cta-section{width:min(960px,calc(100% - 32px));margin:0 auto 84px;text-align:center;padding:46px;border:1px solid var(--line);border-radius:36px;background:linear-gradient(135deg,rgba(139,92,246,.22),rgba(246,198,107,.12));box-shadow:var(--shadow);scroll-margin-top:96px}.lead-form{display:grid;grid-template-columns:1fr 1fr auto;gap:12px;margin-top:24px}.lead-form input{min-width:0;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.08);color:white;padding:15px 18px}.site-footer{width:min(1180px,calc(100% - 32px));margin:auto;padding:36px 0;color:var(--muted);display:flex;justify-content:space-between;border-top:1px solid var(--line)}.reveal{opacity:0;transform:translateY(18px);transition:.7s ease}.reveal.visible{opacity:1;transform:none}@media (max-width:920px){.nav-links{display:none}.section-grid,.social-proof,.pricing-grid{grid-template-columns:1fr}.hero{padding:48px 0 64px}.cards-grid{grid-template-columns:1fr 1fr}.lead-form{grid-template-columns:1fr}.price-card.featured{transform:none}}@media (max-width:640px){.nav-shell{height:66px}.nav-cta{display:none}.hero h1{font-size:40px}.cards-grid,.stats-grid,.mini-grid{grid-template-columns:1fr}.hero-panel{min-height:auto}.cta-section{padding:28px}.site-footer{display:grid;gap:14px}.trust-list li{width:100%;text-align:center}.section-block{margin-bottom:58px}}`;
  const js = `const revealObserver=new IntersectionObserver((entries)=>{for(const entry of entries){if(entry.isIntersecting){entry.target.classList.add('visible');revealObserver.unobserve(entry.target)}}},{threshold:.16});document.querySelectorAll('.reveal').forEach((element)=>revealObserver.observe(element));document.querySelectorAll('a[href^="#"]').forEach((link)=>{link.addEventListener('click',(event)=>{const target=document.querySelector(link.getAttribute('href'));if(target){event.preventDefault();target.scrollIntoView({behavior:'smooth',block:'start'})}})});document.querySelector('.lead-form')?.addEventListener('submit',(event)=>{event.preventDefault();const button=event.currentTarget.querySelector('button');const original=button.textContent;button.textContent='Recebido com sucesso';button.disabled=true;setTimeout(()=>{button.textContent=original;button.disabled=false;event.currentTarget.reset()},1800)});`;
  return [
    { path: "index.html", language: "html", content: html },
    { path: "styles.css", language: "css", content: css },
    { path: "script.js", language: "javascript", content: js },
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(response, fallbackMs) {
  const value = response.headers.get("retry-after");
  if (!value) return fallbackMs;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(5_000, Math.min(seconds * 1000, 180_000));
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(5_000, Math.min(dateMs - Date.now(), 180_000));
  return fallbackMs;
}

async function fetchAiText(model, body, context = {}) {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
        dispatcher: AI_FETCH_DISPATCHER,
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

    if ((response.status === 429 || response.status === 502 || response.status === 503 || response.status === 504) && attempt < maxAttempts) {
      const waitMs = retryAfterMs(response, response.status === 429 ? attempt * 30_000 : attempt * 20_000);
      const reason = response.status === 429 ? "limite do provedor atingido" : `gateway/timeout do provedor (${response.status})`;
      await updateJob(context.supabase, context.jobId, {
        stage: `Forza Engine: ${reason}; aguardando ${Math.round(waitMs / 1000)}s antes de tentar novamente (${attempt}/${maxAttempts - 1})…`,
      });
      await sleep(waitMs);
      continue;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      if (response.status === 401 || response.status === 403) throw new Error(`Falha de autenticação no provedor ${model.label}: confira a API key e o provider selecionado.`);
      if (response.status === 402) throw new Error(`Créditos esgotados no provedor ${model.label}.`);
      if (response.status === 400) throw new Error(`Configuração inválida no provedor ${model.label}: confira endpoint, parâmetros e se o modelo upstream "${model.upstreamModel}" existe. Detalhe: ${text.slice(0, 240)}`);
      if (response.status === 404) throw new Error(`Modelo não encontrado no provedor ${model.label}: confira o modelo upstream "${model.upstreamModel}".`);
      if (response.status === 429) throw new Error(`Limite do provedor ${model.label} atingido mesmo após ${maxAttempts - 1} tentativas. Aguarde alguns minutos ou use outro modelo.`);
      if (response.status === 502 || response.status === 503 || response.status === 504 || /bad gateway|gateway timeout|<html/i.test(text)) throw new Error(`O provedor ${model.label} retornou gateway/instabilidade (${response.status}) mesmo após ${maxAttempts - 1} tentativas. Isso costuma ser falha upstream ou congestionamento do modelo "${model.upstreamModel}"; tente novamente ou use um modelo menor. Detalhe: ${text.replace(/\s+/g, " ").slice(0, 180)}`);
      throw new Error(`Falha no provedor ${model.label} (${response.status}): ${text.slice(0, 240)}`);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("A IA retornou resposta vazia.");
    return content;
  }
  throw new Error(`Limite do provedor ${model.label} atingido. Aguarde alguns minutos ou use outro modelo.`);
}

async function fetchJson(model, messages, fallback, context = {}) {
  const content = await fetchAiText(model, {
    stream: false,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages,
  }, context);
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
  }, { supabase, jobId: job.id });
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
  }, { supabase, jobId: job.id });
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

async function createImplementationTasks(supabase, model, run, job, project, plans) {
  await setPhase(supabase, job.id, run.id, "task_generation", "Forza Engine: quebrando em tasks…");
  const contract = deliveryContract(project, job, plans);
  const taskPlan = await fetchJson(model, [
    {
      role: "system",
      content: "Quebre a implementação em 4 a 6 tasks progressivas para gerar um SaaS/site completo no editor atual. Cada task deve carregar o contexto inteiro do pedido original e produzir/expandir os três arquivos completos, sem perder telas já criadas. Responda somente JSON: {\"tasks\":[{\"title\":\"...\",\"description\":\"...\"}]}",
    },
    { role: "user", content: JSON.stringify({ contract, plans }) },
  ], { tasks: defaultTasks(plans.productPlan, plans.technicalPlan) }, { supabase, jobId: job.id });
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

async function createInitialGenerationTasks(supabase, run) {
  const taskSpecs = [
    ["Estrutura completa", "Gerar HTML/CSS/JS completos em uma chamada forte da IA."],
    ["Conteúdo e seções", "Garantir conteúdo visível, seções reais, CTA, FAQ e footer."],
    ["Interações seguras", "Implementar formulário, navegação, tema ou ações visíveis quando existirem."],
    ["Validação e reparo", "Validar qualidade, expandir conteúdo fraco e bloquear saída insegura."],
  ];
  const tasks = [];
  for (let index = 0; index < taskSpecs.length; index += 1) {
    const [title, description] = taskSpecs[index];
    tasks.push(await createTask(supabase, run.id, index + 1, "implementation", title, description, { generated: true }));
  }
  return tasks;
}

async function generateInitialFiles(supabase, model, run, job, project, plans, skillsContext, initialTasks = []) {
  await setPhase(supabase, job.id, run.id, "implementation", "Forza Engine: gerando entrega completa…");
  const generationTask = initialTasks[0];
  if (generationTask) await updateTask(supabase, generationTask.id, { status: "running" });
  const contract = deliveryContract(project, job, plans);
  const content = await fetchAiText(model, {
    stream: false,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content: "Você é o gerador principal do ForzaAI. Gere a entrega completa em UMA resposta, sem dividir em etapas. Retorne somente:\n=== index.html ===\nHTML completo\n=== styles.css ===\nCSS completo\n=== script.js ===\nJavaScript completo\nObrigatório: página completa e publicável, específica do briefing, com conteúdo real. Não deixe hero/body vazios. Inclua no mínimo 7 seções reais, 6 headings h1-h3, 1400+ caracteres de texto visível, cards/listas, CTA, FAQ e footer. CSS responsivo com @media. JS seguro e funcional para todos os elementos interativos visíveis: formulário, tema claro/escuro, menu, tabs, filtros, carrinho, modais e FAQ quando existirem. Não use eval, innerHTML com dados variáveis, API keys, SQL sensível ou scripts remotos desconhecidos.",
      },
      {
        role: "user",
        content: `Contrato obrigatório:\n${JSON.stringify(contract)}\n\nProjeto: ${project.name}\nPedido original: ${job.message}\nSkills:\n${skillsContext || "—"}\nPlanos:\n${JSON.stringify(plans)}`,
      },
    ],
  }, { supabase, jobId: job.id });
  await saveArtifact(supabase, run.id, "model_raw_output", { initialFullGeneration: true, content: content.slice(0, 120_000) });
  const parsed = normalizeGeneratedFiles(content, project.name);
  if (!parsed) throw new Error("A IA não retornou os três arquivos completos no formato exigido.");
  if (generationTask) await updateTask(supabase, generationTask.id, { status: "completed", output: { files: parsed.map((file) => ({ path: file.path, chars: file.content.length })) }, completed_at: new Date().toISOString() });
  return parsed;
}

async function implementFiles(supabase, model, run, job, project, plans, tasks, currentFiles, skillsContext) {
  await setPhase(supabase, job.id, run.id, "implementation", "Forza Engine: implementando arquivos por tasks…");
  const contract = deliveryContract(project, job, plans);
  let workingFiles = currentFiles?.length ? currentFiles.map((file) => ({ path: file.path, language: file.path === "styles.css" ? "css" : file.path === "script.js" ? "javascript" : "html", content: file.content })) : [];

  for (const task of tasks) {
    await updateTask(supabase, task.id, { status: "running" });
    await updateJob(supabase, job.id, { stage: `Forza Engine: ${task.title}` });
    let content = "";
    try {
      content = await fetchAiText(model, {
        stream: false,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content: "Você é o implementador principal do ForzaAI. O pedido original e o contrato de entrega são a fonte da verdade. Aplique a task atual SEM perder escopo, telas, copy ou componentes já criados. Retorne SEMPRE os três arquivos completos, sem explicação fora dos arquivos:\n=== index.html ===\nHTML completo\n=== styles.css ===\nCSS completo\n=== script.js ===\nJavaScript completo\nMantenha tudo coeso, responsivo, acessível e com visual premium. Para SaaS, simule produto completo: landing, auth visual, dashboard, onboarding, planos, settings, dados mockados e estados reais. Para portfólio/site comercial, entregue hero, prova social, serviços/cases, processo, pricing/oferta, FAQ e contato. Segurança obrigatória: não use eval, innerHTML com dados variáveis, scripts remotos desconhecidos, API keys, service role, SQL ou endpoints sensíveis no código gerado. Interações obrigatórias: botões visíveis devem ter ação segura, links âncora devem rolar suavemente, formulários devem validar e mostrar feedback, toggles claro/escuro devem alternar tema, menus/tabs/filtros/carrinho/modais/FAQ visíveis devem funcionar no script.js.",
          },
          {
            role: "user",
            content: `Contrato de entrega obrigatório:\n${JSON.stringify(contract)}\n\nProjeto: ${project.name}\nPedido original: ${job.message}\nSkills:\n${skillsContext || "—"}\nPlanos:\n${JSON.stringify(plans)}\n\nTask atual: ${task.title}\n${task.description}\n\nArquivos atuais de trabalho:\n${filesContext(workingFiles)}\n\nAntes de responder, confira se os três arquivos finais ainda cumprem o pedido original inteiro e todos os critérios do contrato.`,
          },
        ],
      }, { supabase, jobId: job.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateTask(supabase, task.id, { status: "failed", error: message });
      await saveArtifact(supabase, run.id, "model_raw_output", { taskId: task.id, title: task.title, failed: true, error: message });
      if (workingFiles.length) break;
      throw new Error(`A IA não conseguiu gerar arquivos iniciais válidos: ${message}`);
    }
    const parsed = normalizeGeneratedFiles(content, project.name);
    await saveArtifact(supabase, run.id, "model_raw_output", { taskId: task.id, title: task.title, content: content.slice(0, 120_000) });
    if (!parsed) {
      await updateTask(supabase, task.id, { status: "failed", error: "A IA não retornou arquivos suficientes." });
      if (workingFiles.length) break;
      throw new Error("A IA não retornou os três arquivos completos no formato exigido.");
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

async function synthesizeFinalFiles(supabase, model, run, job, project, plans, files, skillsContext) {
  await setPhase(supabase, job.id, run.id, "implementation", "Forza Engine: consolidando entrega final…");
  const contract = deliveryContract(project, job, plans);
  const content = await fetchAiText(model, {
    stream: false,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content: "Você é o finalizador principal do ForzaAI. Releia o pedido original, contrato, planos e arquivos atuais. Produza uma versão final coesa e premium que preserve o escopo inteiro e corrija lacunas antes da validação. Retorne SEMPRE só neste formato, sem explicação fora dos arquivos:\n=== index.html ===\nHTML completo\n=== styles.css ===\nCSS completo\n=== script.js ===\nJavaScript completo\nObrigatório: produto/site completo, bonito, específico do briefing, responsivo, acessível, com copy BR, sem placeholders e sem segredos. Todo elemento interativo visível precisa funcionar no script.js com comportamento seguro e feedback claro. Evite seções com min-height exagerado, espaços vazios gigantes, header sobrepondo conteúdo, texto colado ou títulos cortados; use scroll-margin-top nas âncoras e line-height legível.",
      },
      {
        role: "user",
        content: `Contrato de entrega obrigatório:\n${JSON.stringify(contract)}\n\nProjeto: ${project.name}\nPedido original: ${job.message}\nSkills:\n${skillsContext || "—"}\nPlanos:\n${JSON.stringify(plans)}\n\nArquivos atuais:\n${filesContext(files)}`,
      },
    ],
  }, { supabase, jobId: job.id });
  await saveArtifact(supabase, run.id, "model_raw_output", { finalSynthesis: true, content: content.slice(0, 120_000) });
  const parsed = normalizeGeneratedFiles(content, project.name);
  return parsed ?? files;
}

async function repairFilesForQuality(supabase, model, run, job, project, plans, files, gateReport) {
  await setPhase(supabase, job.id, run.id, "implementation", "Forza Engine: reforçando qualidade antes da validação…");
  const contract = deliveryContract(project, job, plans);
  const content = await fetchAiText(model, {
    stream: false,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content: "Você é o reparador final do ForzaAI. Recrie e expanda os três arquivos completos para passar quality gates determinísticos. Retorne SEMPRE só neste formato, sem explicação fora dos arquivos:\n=== index.html ===\nHTML completo\n=== styles.css ===\nCSS completo\n=== script.js ===\nJavaScript completo\nObrigatório: HTML premium e completo, CSS robusto com responsividade usando @media, JS seguro sem eval/segredos, zero placeholders/TODO/lorem ipsum, conteúdo específico do pedido. Nunca deixe hero ou body vazios. Inclua no mínimo 6 seções visíveis, 5 títulos, copy real e cards/itens suficientes. Para e-commerce, inclua hero, categorias, vitrine de produtos, benefícios, prova social, FAQ e footer. Para portfólio, inclua hero, bio, serviços, cases/projetos, processo, depoimentos/prova social e contato. Para SaaS/app, inclua landing, onboarding, dashboard, pricing/billing, settings e dados mockados seguros.",
      },
      {
        role: "user",
        content: `Contrato obrigatório:\n${JSON.stringify(contract)}\n\nProjeto: ${project.name}\nPedido original: ${job.message}\nPlanos:\n${JSON.stringify(plans)}\n\nProblemas detectados:\n${(gateReport.issues || []).join("\n")}\n\nArquivos atuais:\n${filesContext(files)}`,
      },
    ],
  }, { supabase, jobId: job.id });
  await saveArtifact(supabase, run.id, "model_raw_output", { repair: true, content: content.slice(0, 120_000), issues: gateReport.issues || [] });
  const parsed = normalizeGeneratedFiles(content, project.name);
  if (!parsed) return files;
  const parsedReport = deterministicQualityReport(project, job, parsed);
  if (parsedReport.passed) return parsed;

  await setPhase(supabase, job.id, run.id, "implementation", "Forza Engine: expandindo conteúdo visível…");
  const expansion = await fetchAiText(model, {
    stream: false,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content: "Você é o expansor final de conteúdo do ForzaAI. O HTML atual é válido, mas insuficiente. Não resuma. Reescreva os três arquivos completos com uma página cheia e navegável. Retorne somente:\n=== index.html ===\nHTML completo\n=== styles.css ===\nCSS completo\n=== script.js ===\nJavaScript completo\nRegras: no mínimo 7 seções reais, 6 headings h1-h3, 1400+ caracteres de texto visível, cards/listas, CTA, FAQ e footer. Nada de conteúdo vazio. Formulários, tema claro/escuro, filtros, carrinho, tabs, modais, menu mobile e FAQ visíveis precisam funcionar no script.js.",
      },
      {
        role: "user",
        content: `Contrato obrigatório:\n${JSON.stringify(contract)}\n\nProblemas restantes:\n${(parsedReport.issues || []).join("\n")}\n\nArquivos para expandir:\n${filesContext(parsed)}`,
      },
    ],
  }, { supabase, jobId: job.id });
  await saveArtifact(supabase, run.id, "model_raw_output", { expansion: true, content: expansion.slice(0, 120_000), issues: parsedReport.issues || [] });
  return normalizeGeneratedFiles(expansion, project.name) ?? parsed;
}

function visibleTextFromHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function deterministicQualityReport(project, job, files) {
  const byPath = Object.fromEntries(files.map((file) => [file.path, file.content || ""]));
  const html = byPath["index.html"] || "";
  const css = byPath["styles.css"] || "";
  const js = byPath["script.js"] || "";
  const combined = `${html}\n${css}\n${js}`;
  const visibleText = visibleTextFromHtml(html);
  const sectionCount = (html.match(/<section\b/gi) || []).length;
  const headingCount = (html.match(/<h[1-3]\b/gi) || []).length;
  const issues = [];

  for (const path of ["index.html", "styles.css", "script.js"]) {
    if (!byPath[path]?.trim()) issues.push(`Arquivo obrigatório ausente ou vazio: ${path}`);
  }
  if (html.length < 6000) issues.push("HTML curto demais para uma entrega premium completa.");
  if (visibleText.length < 1200) issues.push("Conteúdo visível insuficiente para uma página completa.");
  if (sectionCount < 4) issues.push("Poucas seções visíveis para a página solicitada.");
  if (headingCount < 4) issues.push("Poucos títulos/seções estruturadas no HTML.");
  if (css.length < 2500) issues.push("CSS curto demais para layout responsivo e visual premium.");
  if (!/@media\b/i.test(css)) issues.push("CSS não contém responsividade mínima com media queries.");
  if (/ForzaAI\s*<\/h1>|Home\s*<\/button>|Templates\s*<\/button>|Analytics\s*<\/button>|Configurações\s*<\/button>/i.test(html)) {
    issues.push("Preview parece scaffold genérico do ForzaAI, não o site solicitado.");
  }
  const contentWithoutAttributes = combined.replace(/\splaceholder=("[^"]*"|'[^']*')/gi, "");
  if (/TODO|lorem ipsum|coming soon|em breve/i.test(contentWithoutAttributes)) issues.push("Arquivos contêm placeholders ou conteúdo incompleto.");
  if (/eval\s*\(|service[_-]?role|api[_-]?key\s*=|sk-[a-z0-9]{20,}/i.test(combined)) issues.push("Arquivos contêm padrão inseguro ou possível segredo.");
  if (/<form\b/i.test(html) && !/addEventListener\(['"]submit|onsubmit|checkValidity|preventDefault/i.test(js)) {
    issues.push("Formulário visível sem validação ou feedback no JavaScript.");
  }
  const hasExplicitThemeControl = /(?:id|class|data-[\w-]+|aria-label)=("[^"]*(?:theme|tema|dark|light|claro|escuro)[^"]*"|'[^']*(?:theme|tema|dark|light|claro|escuro)[^']*')|<button[^>]*>[^<]*(?:tema|theme|dark|light|claro|escuro)/i.test(html);
  if (hasExplicitThemeControl && !/classList\.toggle|dataset\.theme|localStorage|prefers-color-scheme/i.test(js)) {
    issues.push("Toggle/tema visual sem implementação funcional no JavaScript.");
  }
  if (/<details\b|faq/i.test(html) && !/<details\b/i.test(html) && !/addEventListener\(['"]click|aria-expanded|classList\.toggle/i.test(js)) {
    issues.push("FAQ/interação expansível sem comportamento funcional.");
  }
  if (/cart|carrinho|add-to-cart|adicionar/i.test(html) && !/cart|carrinho|addEventListener\(['"]click|quantity|total/i.test(js)) {
    issues.push("Carrinho ou ações de compra visíveis sem lógica básica no JavaScript.");
  }

  const request = String(job.message || project.name || "").toLowerCase();
  const requestTerms = request
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 5 && !["quero", "criar", "fazer", "site", "para", "com", "uma", "como", "pagina", "landing"].includes(term))
    .slice(0, 10);
  const normalizedCombined = combined.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const matchedTerms = requestTerms.filter((term) => normalizedCombined.includes(term)).length;
  if (requestTerms.length >= 3 && matchedTerms < Math.min(3, requestTerms.length)) {
    issues.push("Entrega não reflete termos específicos suficientes do pedido original.");
  }

  if (/portfolio|portfólio/.test(request)) {
    const portfolioSignals = ["projeto", "case", "portfolio", "portfólio", "designer", "contato", "serviço"];
    const found = portfolioSignals.filter((signal) => combined.toLowerCase().includes(signal)).length;
    if (found < 4) issues.push("Portfólio não tem seções/conteúdo suficientes de designer, cases, serviços e contato.");
  }
  if (/saas|dashboard|app|sistema|crm|billing|pricing/.test(request)) {
    const appSignals = ["dashboard", "onboarding", "settings", "configura", "pricing", "plano", "billing", "login"];
    const found = appSignals.filter((signal) => combined.toLowerCase().includes(signal)).length;
    if (found < 4) issues.push("SaaS/app não possui telas e fluxos suficientes além de uma home.");
  }

  const blockingIssues = issues.filter((issue) => /Arquivo obrigatório|padrão inseguro|possível segredo|Conteúdo visível insuficiente|Poucas seções|Poucos títulos|Formulário visível|Toggle\/tema visual|Carrinho ou ações de compra/i.test(issue));
  return {
    passed: blockingIssues.length === 0,
    score: Math.max(55, 100 - issues.length * 10),
    summary: blockingIssues.length === 0 ? "Quality gates bloqueantes aprovados; apontamentos restantes são melhorias." : "Quality gates bloqueantes reprovaram a geração.",
    issues,
    blocking_issues: blockingIssues,
  };
}

async function validateFiles(supabase, model, run, job, project, plans, files) {
  await setPhase(supabase, job.id, run.id, "validation", "Forza Engine: validando qualidade…");
  const gateReport = deterministicQualityReport(project, job, files);
  const report = await fetchJson(model, [
    {
      role: "system",
      content: "Você é o revisor final do ForzaAI. Avalie se os arquivos cumprem o briefing e critérios de SaaS/site premium. Seja rigoroso com: não ser só home, responsividade, acessibilidade, copy BR, consistência visual, fluxos de SaaS, JS seguro e ausência de segredos/API keys/SQL no frontend. Responda somente JSON com: score 0-100, passed boolean, summary, issues, improvements, security_findings, missing_scope.",
    },
    { role: "user", content: JSON.stringify({ project, request: job.message, deterministic_gates: gateReport, plans, files: files.map((file) => ({ path: file.path, chars: file.content.length, preview: file.content.slice(0, 6000) })) }) },
  ], { score: 85, passed: true, summary: "Validação concluída.", issues: [], improvements: [] }, { supabase, jobId: job.id });
  const modelIssues = Array.isArray(report.issues) ? report.issues : [];
  const finalReport = {
    ...report,
    deterministic_gates: gateReport,
    model_review: report,
    issues: gateReport.issues || [],
  };
  finalReport.score = Math.max(70, gateReport.score);
  finalReport.passed = gateReport.passed;
  finalReport.summary = finalReport.passed
    ? `Quality gates bloqueantes aprovados. Revisão IA registrada como consultiva (${modelIssues.length} apontamentos).`
    : gateReport.summary;
  await saveArtifact(supabase, run.id, "validation_report", finalReport);
  if (!finalReport.passed) {
    throw new Error(`A geração foi reprovada pelos quality gates (${finalReport.score}/100): ${finalReport.issues.slice(0, 4).join("; ")}`);
  }
  return finalReport;
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
    const tasks = currentFiles?.length ? await createImplementationTasks(supabase, model, run, job, project, plans) : await createInitialGenerationTasks(supabase, run);
    let files = currentFiles?.length
      ? await implementFiles(supabase, model, run, job, project, plans, tasks, currentFiles, skillsContext)
      : await generateInitialFiles(supabase, model, run, job, project, plans, skillsContext, tasks);
    if (!currentFiles?.length && tasks[1]) await updateTask(supabase, tasks[1].id, { status: "running" });
    files = await synthesizeFinalFiles(supabase, model, run, job, project, plans, files, skillsContext);
    if (!currentFiles?.length && tasks[1]) await updateTask(supabase, tasks[1].id, { status: "completed", completed_at: new Date().toISOString() });
    if (!currentFiles?.length && tasks[2]) await updateTask(supabase, tasks[2].id, { status: "running" });
    const firstGateReport = deterministicQualityReport(project, job, files);
    if (!firstGateReport.passed) {
      if (!currentFiles?.length && tasks[3]) await updateTask(supabase, tasks[3].id, { status: "running" });
      files = await repairFilesForQuality(supabase, model, run, job, project, plans, files, firstGateReport);
      const repairedGateReport = deterministicQualityReport(project, job, files);
      if (!repairedGateReport.passed) {
          if (!currentFiles?.length && tasks[2]) await updateTask(supabase, tasks[2].id, { status: "failed", error: (repairedGateReport.blocking_issues || repairedGateReport.issues || []).slice(0, 4).join("; ") });
        if (!currentFiles?.length && tasks[3]) await updateTask(supabase, tasks[3].id, { status: "failed", error: (repairedGateReport.blocking_issues || repairedGateReport.issues || []).slice(0, 4).join("; ") });
        await saveArtifact(supabase, run.id, "quality_gate_report", { blocked: true, beforeRepair: firstGateReport, afterRepair: repairedGateReport });
        throw new Error(`A IA gerou arquivos inseguros ou incompletos mesmo após reparo: ${(repairedGateReport.blocking_issues || repairedGateReport.issues || []).slice(0, 4).join("; ")}`);
      }
      if (!currentFiles?.length && tasks[2]) await updateTask(supabase, tasks[2].id, { status: "completed", completed_at: new Date().toISOString() });
      if (!currentFiles?.length && tasks[3]) await updateTask(supabase, tasks[3].id, { status: "completed", completed_at: new Date().toISOString() });
    } else {
      if (!currentFiles?.length && tasks[2]) await updateTask(supabase, tasks[2].id, { status: "completed", completed_at: new Date().toISOString() });
      if (!currentFiles?.length && tasks[3]) await updateTask(supabase, tasks[3].id, { status: "completed", completed_at: new Date().toISOString() });
      await saveArtifact(supabase, run.id, "quality_gate_report", { preservedAiOutput: true, report: firstGateReport });
    }
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
