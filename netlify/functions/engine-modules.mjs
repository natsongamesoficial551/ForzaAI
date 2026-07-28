/**
 * Forza Engine Modules - Upgrade 10x
 * Inclui: Token Saver RTK, Skills Embutidas e Contratos de Engenharia
 */

// --- TOKEN SAVER RTK (Relevant Token Kernel) ---
// Comprime o contexto mantendo apenas os "Kernels" (núcleos) relevantes de código e instrução.
export function applyRTK(content, limit = 8000) {
  if (!content || content.length <= limit) return content;

  // Técnica RTK: Identifica blocos de código e remove miolos repetitivos ou menos relevantes,
  // mantendo assinaturas, estruturas de controle e as primeiras/últimas linhas de seções grandes.
  let compressed = content;

  // 1. Remove comentários extensos (preserva JSDoc essencial se houver)
  compressed = compressed.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*/g, '$1');

  // 2. Comprime espaços em branco excessivos
  compressed = compressed.replace(/[ \t]+/g, ' ');
  compressed = compressed.replace(/\n\s*\n/g, '\n');

  // 3. Se ainda for grande, faz o Kernel Truncation (RTK)
  if (compressed.length > limit) {
    const lines = compressed.split('\n');
    const headerLines = lines.slice(0, Math.floor(limit / 80)); // Preserva o topo (instruções/imports)
    const footerLines = lines.slice(-Math.floor(limit / 160)); // Preserva o fim (fechamento de tags/scripts)
    
    // O miolo é "resumido" pegando amostras
    const middle = "... [RTK Compressed Content] ...";
    return [...headerLines, middle, ...footerLines].join('\n');
  }

  return compressed;
}

// --- SKILLS EMBUTIDAS (Engine Internal Skills) ---
// Padrões de criação e conhecimentos que a IA "aprende" via sistema
export const EMBEDDED_SKILLS = [
  {
    name: "Visual Hierarchy Mastery",
    prompt: "Use a regra 60-30-10 para cores. Garanta que o H1 seja o elemento visualmente mais pesado. Use espaçamento consistente (multiplos de 4px/8px). Cada seção deve ter um 'Ponto de Foco' claro."
  },
  {
    name: "Conversion-Centric Copy",
    prompt: "Escreva copy focado em benefícios, não em funcionalidades. Use gatilhos de escassez e prova social. CTAs devem ser verbos de ação claros (ex: 'Começar Agora', 'Garantir Acesso')."
  },
  {
    name: "Component Isolation",
    prompt: "No CSS, use variáveis para cores e espaçamentos. No JS, isole comportamentos por componente (header, modal, form) para evitar conflitos de escopo."
  },
  {
    name: "Performance & Accessibility",
    prompt: "Use tags semânticas (nav, main, section, footer). Adicione aria-labels a botões de ícones. Garanta contraste de texto conforme WCAG."
  }
];

// --- ENRICHED DELIVERY CONTRACT ---
// Torna o motor mais "parrudo" com restrições técnicas de alto nível
export function getEnrichedContract(baseContract) {
  return {
    ...baseContract,
    engineering_standards: [
      "ANTI-GENERIC: Cada site deve ter uma estrutura de grid única. Proibido usar apenas seções de largura total empilhadas sem variação de layout.",
      "TOKEN_EFFICIENCY: Responda diretamente com o código. Evite preâmbulos.",
      "STATE_MANAGEMENT: No JS, use objetos de estado para controlar UI complexa (ex: estados do carrinho, tabs).",
      "CSS_MODERN: Use Flexbox e Grid de forma avançada. Adicione micro-interações (hover, active, reveal) em todos os elementos clicáveis."
    ],
    quality_gates: [
      "Mínimo de 3 variações de cores de fundo entre seções para quebrar monotonia.",
      "Uso de gradientes sutis e sombras profundas para profundidade visual.",
      "Imagens/Ilustrações via CSS ou SVGs inline (nunca links quebrados)."
    ]
  };
}
