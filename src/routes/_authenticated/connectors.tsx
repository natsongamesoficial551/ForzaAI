import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { Database, Github, KeyRound, Plug, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  deleteConnectorSecret,
  getCustomAiTokenBalance,
  listConnectors,
  startGithubOAuth,
} from "@/lib/connectors.functions";

export const Route = createFileRoute("/_authenticated/connectors")({ component: Connectors });

const connectors = [
  {
    id: "supabase",
    name: "Banco de dados",
    description: "Supabase/Postgres para a IA ler schema, propor migrations, preparar RLS e configurar tabelas com aprovação segura.",
    icon: Database,
    status: "Preparando OAuth seguro",
    action: "Conectar banco de dados",
    enabled: true,
    capabilities: ["Ler schema", "Propor tabelas", "Planejar RLS", "Validar migrations"],
  },
  {
    id: "github",
    name: "GitHub",
    description: "OAuth gratuito para repositórios, branches, commits, pull requests e exportação de código quando o app oficial estiver configurado.",
    icon: Github,
    status: "Pronto para OAuth",
    action: "Conectar GitHub",
    enabled: true,
    capabilities: ["Criar repositório", "Gerar branch", "Commitar arquivos", "Abrir PR"],
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Stripe Connect OAuth para produtos, preços, checkout, Pix, assinaturas e billing usando a conta Stripe do cliente.",
    icon: KeyRound,
    status: "Pronto para OAuth",
    action: "Conectar Stripe",
    enabled: true,
    capabilities: ["Criar produtos", "Criar preços", "Configurar checkout", "Planejar webhooks"],
  },
  {
    id: "figma",
    name: "Figma",
    description: "Importação futura de design, tokens visuais e assets quando o app OAuth oficial do ForzaAI estiver configurado.",
    icon: Plug,
    status: "OAuth futuro",
    action: "Conectar Figma",
    enabled: true,
    capabilities: ["Importar frames", "Ler estilos", "Mapear componentes", "Extrair assets"],
  },
  {
    id: "custom-ai",
    name: "IA sob demanda",
    description: "A IA do ForzaAI pode ser integrada nos sites gerados quando o cliente pedir chat, PDF, gerador ou outro recurso inteligente.",
    icon: Shield,
    status: "Gerenciada pelo ForzaAI",
    action: "Gerenciada automaticamente",
    enabled: false,
    capabilities: ["Chat no site", "Analisar PDF", "Gerar conteúdo", "Usar API protegida"],
  },
] as const;

function Connectors() {
  const qc = useQueryClient();
  const listConnectorsFn = useServerFn(listConnectors);
  const deleteConnectorSecretFn = useServerFn(deleteConnectorSecret);
  const getCustomAiTokenBalanceFn = useServerFn(getCustomAiTokenBalance);
  const startGithubOAuthFn = useServerFn(startGithubOAuth);

  const { data: saved } = useQuery({
    queryKey: ["connectors"],
    queryFn: () => listConnectorsFn(),
  });

  const { data: tokenBalance } = useQuery({
    queryKey: ["custom-ai-token-balance"],
    queryFn: () => getCustomAiTokenBalanceFn(),
  });

  const savedConnectors = saved ?? [];
  const connectedConnectors = connectors.flatMap((connector) =>
    savedConnectors
      .filter((item: any) => item.provider === connector.id)
      .map((item: any) => ({ ...item, connector })),
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "github") toast.success("GitHub conectado com segurança");
    if (params.get("error") === "github_oauth") toast.error("Não consegui concluir o OAuth do GitHub");
  }, []);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => deleteConnectorSecretFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["connectors"] });
      toast.success("Conector removido");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const githubOAuthMutation = useMutation({
    mutationFn: async () => startGithubOAuthFn(),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleConnectorClick = (connector: (typeof connectors)[number]) => {
    if (connector.id === "github") {
      githubOAuthMutation.mutate();
      return;
    }
    toast.info(`${connector.name} OAuth será ativado quando o app oficial estiver configurado com segurança no backend.`);
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold">Conectores</h1>
        <p className="text-muted-foreground mt-1">
          Conecte banco de dados, GitHub, Stripe e ferramentas externas por OAuth seguro. Tokens e segredos nunca aparecem no frontend.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 mb-6">
        <h2 className="font-display text-xl font-semibold">Integrações por OAuth</h2>
        <p className="text-sm text-muted-foreground mt-2">
          A meta é funcionar como Lovable: o usuário autoriza sua própria conta e o ForzaAI executa ações pelo backend com aprovação. Nesta fase, os conectores ficam preparados visualmente sem pedir API key manual.
        </p>
        <div className="grid md:grid-cols-2 gap-3 mt-4">
          {connectors.filter((connector) => connector.enabled).map((connector) => (
            <Button
              key={connector.id}
              variant="outline"
              className="h-auto justify-start gap-3 p-4"
              onClick={() => handleConnectorClick(connector)}
              disabled={connector.id === "github" && githubOAuthMutation.isPending}
            >
              <connector.icon className="size-5 text-primary" />
              <span className="text-left">
                <span className="block font-medium">{connector.action}</span>
                <span className="block text-xs text-muted-foreground">{connector.status}</span>
              </span>
            </Button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 mb-6">
        <h2 className="font-display text-lg font-semibold">Automação segura da IA</h2>
        <p className="text-sm text-muted-foreground mt-1">
          No próximo estágio, a IA poderá ler metadados dos conectores e pedir ações como criar tabela, produto Stripe ou commit GitHub. A execução real ficará em server functions com confirmação para ações sensíveis. Saldo técnico de IA sob demanda: {tokenBalance ?? 0} token(s).
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 mb-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold">Conectores conectados</h2>
            <p className="text-sm text-muted-foreground mt-1">Serviços já autorizados pela sua conta para uso seguro no backend do ForzaAI.</p>
          </div>
          <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            {connectedConnectors.length} conectado(s)
          </span>
        </div>
        <div className="mt-4 space-y-2">
          {connectedConnectors.length > 0 ? (
            connectedConnectors.map((item: any) => {
              const Icon = item.connector.icon;
              return (
                <div key={item.id} className="flex items-center justify-between rounded-xl border border-border bg-background/60 p-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="size-9 rounded-lg bg-primary/10 grid place-items-center shrink-0">
                      <Icon className="size-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{item.connector.name} conectado</div>
                      <div className="text-xs text-muted-foreground truncate">{item.secret_name}</div>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(item.id)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              );
            })
          ) : (
            <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
              Nenhum conector conectado ainda. Quando o OAuth terminar com sucesso, ele aparecerá aqui.
            </div>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {connectors.map((connector) => {
          const Icon = connector.icon;
          const rows = savedConnectors.filter((item: any) => item.provider === connector.id);
          const isConnected = rows.length > 0;
          return (
            <div key={connector.name} className="rounded-2xl border border-border bg-card p-6">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="size-11 rounded-xl bg-primary/10 grid place-items-center">
                  <Icon className="size-5 text-primary" />
                </div>
                <span className={isConnected ? "rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600" : "rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground"}>
                  {isConnected ? "Conectado" : connector.status}
                </span>
              </div>
              <h2 className="font-display text-xl font-semibold">{connector.name}</h2>
              <p className="text-sm text-muted-foreground mt-2">{connector.description}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {connector.capabilities.map((capability) => (
                  <span key={capability} className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">
                    {capability}
                  </span>
                ))}
              </div>
              <div className="mt-4 space-y-2">
                {rows.map((row: any) => (
                  <div key={row.id} className="flex items-center justify-between rounded-lg border border-border p-2 text-sm">
                    <span>{row.secret_name}</span>
                    <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(row.id)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                {rows.length === 0 && (
                  <div className="text-xs text-muted-foreground">
                    {connector.enabled ? "Nenhuma conexão OAuth ativa ainda." : connector.status}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
