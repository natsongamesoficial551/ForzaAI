import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Sparkles, MessageSquare, Code2, Rocket, Zap, Shield, Globe2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/dashboard" });
  },
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-dvh bg-background overflow-x-clip">
      {/* nav */}
      <header className="border-b border-border/50 backdrop-blur-md sticky top-0 z-50 bg-background/80">
        <div className="container mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2">
            <div className="size-8 rounded-lg bg-gradient-primary shadow-glow grid place-items-center">
              <Sparkles className="size-4 text-primary-foreground" />
            </div>
            <span className="font-display font-bold text-lg">ForzaAI</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition-colors">
              Recursos
            </a>
            <a href="#pricing" className="hover:text-foreground transition-colors">
              Preços
            </a>
          </nav>
          <Link to="/login">
            <Button variant="default" className="bg-gradient-primary shadow-glow hover:opacity-90 px-4 sm:px-6">
              Entrar
            </Button>
          </Link>
        </div>
      </header>

      {/* hero */}
      <section className="container mx-auto px-4 sm:px-6 pt-14 sm:pt-20 md:pt-24 pb-16 sm:pb-24 md:pb-32 text-center relative">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_center,_var(--primary)_0%,_transparent_50%)] opacity-10" />
        <div className="inline-flex max-w-full items-center gap-2 px-3 py-1 rounded-full bg-card border border-border text-[11px] sm:text-xs text-muted-foreground mb-6 sm:mb-8">
          <span className="size-1.5 rounded-full bg-primary animate-pulse" />
          Anti-alucinação · Deploy automático · 100 créditos grátis
        </div>
        <h1 className="font-display font-bold text-4xl sm:text-5xl md:text-7xl tracking-tight max-w-4xl mx-auto leading-[1.05]">
          Crie sites profissionais <span className="text-gradient">conversando com IA</span>
        </h1>
        <p className="mt-5 sm:mt-6 text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
          ForzaAI faz 20 a 40 perguntas certeiras antes de gerar uma linha de código — chega de IA
          inventando seus produtos, seu telefone, seu endereço. Você descreve, a gente publica.
        </p>
        <div className="mt-8 sm:mt-10 flex flex-col sm:flex-row flex-wrap gap-3 justify-center">
          <Link to="/login" className="w-full sm:w-auto">
            <Button
              size="lg"
              className="w-full sm:w-auto bg-gradient-primary shadow-glow hover:opacity-90 h-12 px-8 text-base"
            >
              Começar grátis
            </Button>
          </Link>
          <a href="#features" className="w-full sm:w-auto">
            <Button size="lg" variant="outline" className="w-full sm:w-auto h-12 px-8 text-base">
              Ver como funciona
            </Button>
          </a>
        </div>
      </section>

      {/* features */}
      <section id="features" className="container mx-auto px-4 sm:px-6 py-14 sm:py-20">
        <div className="grid md:grid-cols-3 gap-6">
          {[
            {
              icon: MessageSquare,
              t: "Chat anti-alucinação",
              d: "Questionário guiado que garante 100% de contexto antes da IA escrever código.",
            },
            {
              icon: Code2,
              t: "Editor + Preview ao vivo",
              d: "Veja seu site renderizando enquanto a IA gera. Edite com Monaco quando quiser ajustar.",
            },
            {
              icon: Rocket,
              t: "Deploy em 1 clique",
              d: "Publicação automática com subdomínio grátis ou seu domínio personalizado.",
            },
            {
              icon: Zap,
              t: "Créditos justos",
              d: "50 para criar, 15 para modificar. Plano diário a partir de R$ 4,90.",
            },
            {
              icon: Shield,
              t: "Seu código, seu controle",
              d: "Push para GitHub, baixe o ZIP, hospede onde quiser.",
            },
            {
              icon: Globe2,
              t: "20 idiomas",
              d: "Interface e geração suportam português, inglês, espanhol, francês e mais.",
            },
          ].map((f) => (
            <div
              key={f.t}
              className="p-6 rounded-xl border border-border bg-card hover:border-primary/50 transition-colors group"
            >
              <div className="size-10 rounded-lg bg-primary/10 grid place-items-center mb-4 group-hover:bg-primary/20 transition-colors">
                <f.icon className="size-5 text-primary" />
              </div>
              <h3 className="font-display font-semibold text-lg">{f.t}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* pricing */}
      <section id="pricing" className="container mx-auto px-4 sm:px-6 py-14 sm:py-20">
        <h2 className="font-display font-bold text-3xl sm:text-4xl text-center">Planos simples</h2>
        <p className="text-center text-muted-foreground mt-2">
          Cancele quando quiser. Pague no Pix ou cartão.
        </p>
        <div className="grid md:grid-cols-3 gap-6 mt-12 max-w-5xl mx-auto">
          {[
            { name: "Diário", price: "R$ 4,90", per: "/dia", credits: "300 créditos" },
            {
              name: "Semanal",
              price: "R$ 19,90",
              per: "/semana",
              credits: "600 créditos",
              featured: true,
            },
            { name: "Mensal", price: "R$ 49,90", per: "/mês", credits: "1.200 créditos" },
          ].map((p) => (
            <div
              key={p.name}
              className={`p-6 sm:p-8 rounded-2xl border ${p.featured ? "border-primary bg-card shadow-glow" : "border-border bg-card"}`}
            >
              <h3 className="font-display text-2xl font-semibold">{p.name}</h3>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-bold">{p.price}</span>
                <span className="text-muted-foreground">{p.per}</span>
              </div>
              <p className="mt-4 text-accent">{p.credits}</p>
              <Link to="/login" className="block mt-6">
                <Button
                  className={`w-full ${p.featured ? "bg-gradient-primary shadow-glow" : ""}`}
                  variant={p.featured ? "default" : "outline"}
                >
                  Começar
                </Button>
              </Link>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border/50 mt-20">
        <div className="container mx-auto px-6 py-8 text-center text-sm text-muted-foreground">
          © 2026 ForzaAI · Feito com IA para empresários reais
        </div>
      </footer>
    </div>
  );
}
