import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Github, KeyRound, Plug, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  deleteConnectorSecret,
  getCustomAiTokenBalance,
  listConnectors,
} from "@/lib/connectors.functions";

export const Route = createFileRoute("/_authenticated/connectors")({ component: Connectors });

const connectors = [
  {
    id: "github",
    name: "GitHub",
    description: "OAuth gratuito para repositórios, commits e exportação de código quando o app GitHub estiver configurado.",
    icon: Github,
    status: "Pronto para OAuth",
    action: "Conectar GitHub",
    enabled: true,
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "OAuth gratuito para conectar pagamentos, checkout, Pix e assinaturas via conta Stripe do cliente.",
    icon: KeyRound,
    status: "Pronto para OAuth",
    action: "Conectar Stripe",
    enabled: true,
  },
  {
    id: "supabase",
    name: "Supabase",
    description: "OAuth público não está liberado nesta fase; a integração manual fica oculta para não confundir usuários.",
    icon: Shield,
    status: "Oculto até integração gratuita viável",
    action: "Indisponível nesta fase",
    enabled: false,
  },
  {
    id: "figma",
    name: "Figma",
    description: "Fica oculto até confirmar OAuth gratuito e configurar o app oficial do ForzaAI.",
    icon: Plug,
    status: "Oculto até confirmar plano gratuito",
    action: "Indisponível nesta fase",
    enabled: false,
  },
  {
    id: "custom-ai",
    name: "IA sob demanda",
    description: "A IA do ForzaAI pode ser integrada nos sites gerados quando o cliente pedir chat, PDF, gerador ou outro recurso inteligente.",
    icon: KeyRound,
    status: "Usa a API protegida do ForzaAI",
    action: "Gerenciada automaticamente",
    enabled: false,
  },
] as const;

function Connectors() {
  const qc = useQueryClient();
  const listConnectorsFn = useServerFn(listConnectors);
  const deleteConnectorSecretFn = useServerFn(deleteConnectorSecret);
  const getCustomAiTokenBalanceFn = useServerFn(getCustomAiTokenBalance);

  const { data: saved } = useQuery({
    queryKey: ["connectors"],
    queryFn: () => listConnectorsFn(),
  });

  const { data: tokenBalance } = useQuery({
    queryKey: ["custom-ai-token-balance"],
    queryFn: () => getCustomAiTokenBalanceFn(),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => deleteConnectorSecretFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["connectors"] });
      toast.success("Conector removido");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold">Conectores</h1>
        <p className="text-muted-foreground mt-1">
Integrações gratuitas por OAuth quando disponíveis; qualquer segredo fica protegido no backend.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 mb-6">
        <h2 className="font-display text-xl font-semibold">Integrações por OAuth</h2>
        <p className="text-sm text-muted-foreground mt-2">
          O usuário não precisa buscar API key manualmente. GitHub e Stripe ficam como integrações gratuitas por OAuth quando os apps oficiais estiverem configurados nas variáveis privadas da Netlify.
        </p>
        <div className="grid md:grid-cols-2 gap-3 mt-4">
          {connectors.filter((connector) => connector.enabled).map((connector) => (
            <Button
              key={connector.id}
              variant="outline"
              className="h-auto justify-start gap-3 p-4"
              onClick={() => toast.info(`${connector.name} OAuth será ativado quando o app oficial estiver configurado.`)}
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
        <h2 className="font-display text-lg font-semibold">IA sob demanda nos sites</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Quando o cliente pedir chat, analisador de PDF, gerador com IA ou outro recurso inteligente, o ForzaAI poderá gerar a integração usando sua API protegida. Saldo técnico atual: {tokenBalance ?? 0} token(s).
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {connectors.map((connector) => {
          const Icon = connector.icon;
          const rows = (saved ?? []).filter((item: any) => item.provider === connector.id);
          return (
            <div key={connector.name} className="rounded-2xl border border-border bg-card p-6">
              <div className="size-11 rounded-xl bg-primary/10 grid place-items-center mb-4">
                <Icon className="size-5 text-primary" />
              </div>
              <h2 className="font-display text-xl font-semibold">{connector.name}</h2>
              <p className="text-sm text-muted-foreground mt-2">{connector.description}</p>
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
                    {connector.enabled ? "Nenhuma conexão OAuth ativa." : connector.status}
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
