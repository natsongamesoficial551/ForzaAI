import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Github, KeyRound, Loader2, Plug, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  deleteConnectorSecret,
  getCustomAiTokenBalance,
  listConnectors,
  saveConnectorSecret,
} from "@/lib/connectors.functions";

export const Route = createFileRoute("/_authenticated/connectors")({ component: Connectors });

const connectors = [
  { id: "supabase", name: "Supabase", description: "URL, anon key ou service key criptografada para projetos dos clientes.", icon: Shield },
  { id: "stripe", name: "Stripe", description: "Chaves próprias do cliente para pagamentos, checkout, Pix e assinaturas.", icon: KeyRound },
  { id: "github", name: "GitHub", description: "Token ou OAuth app para repositórios, commits e exportação de código.", icon: Github },
  { id: "figma", name: "Figma", description: "Token ou OAuth app para designs e referências visuais.", icon: Plug },
  { id: "custom-ai", name: "IA personalizada", description: "API key própria do usuário, criptografada e cobrada por tokens separados.", icon: KeyRound },
] as const;

type ProviderId = (typeof connectors)[number]["id"];

function Connectors() {
  const qc = useQueryClient();
  const listConnectorsFn = useServerFn(listConnectors);
  const saveConnectorSecretFn = useServerFn(saveConnectorSecret);
  const deleteConnectorSecretFn = useServerFn(deleteConnectorSecret);
  const getCustomAiTokenBalanceFn = useServerFn(getCustomAiTokenBalance);
  const [provider, setProvider] = useState<ProviderId>("supabase");
  const [secretName, setSecretName] = useState("api_key");
  const [secretValue, setSecretValue] = useState("");

  const { data: saved } = useQuery({
    queryKey: ["connectors"],
    queryFn: () => listConnectorsFn(),
  });

  const { data: tokenBalance } = useQuery({
    queryKey: ["custom-ai-token-balance"],
    queryFn: () => getCustomAiTokenBalanceFn(),
  });

  const saveMutation = useMutation({
    mutationFn: async () =>
      saveConnectorSecretFn({
        data: {
          provider,
          secretName,
          secretValue,
          metadata: { configuredFrom: "connectors-page" },
        },
      }),
    onSuccess: () => {
      setSecretValue("");
      qc.invalidateQueries({ queryKey: ["connectors"] });
      toast.success("Conector salvo com criptografia");
    },
    onError: (e: Error) => toast.error(e.message),
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
          Integrações reais ficam protegidas no backend com AES-GCM e ENCRYPTION_KEY da Netlify.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 mb-6">
        <h2 className="font-display text-xl font-semibold">Adicionar credencial</h2>
        <div className="grid md:grid-cols-[1fr_1fr_2fr_auto] gap-3 mt-4">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as ProviderId)}
            className="rounded-md border border-border bg-background px-3 text-sm"
          >
            {connectors.map((connector) => (
              <option key={connector.id} value={connector.id}>
                {connector.name}
              </option>
            ))}
          </select>
          <Input value={secretName} onChange={(e) => setSecretName(e.target.value)} placeholder="Nome da chave" />
          <Input
            type="password"
            value={secretValue}
            onChange={(e) => setSecretValue(e.target.value)}
            placeholder="Cole a chave/token aqui"
          />
          <Button onClick={() => saveMutation.mutate()} disabled={!secretName.trim() || !secretValue.trim() || saveMutation.isPending}>
            {saveMutation.isPending && <Loader2 className="size-4 animate-spin" />}
            Salvar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Supabase: use URL + anon key quando possível. Service role só quando o usuário souber o risco. GitHub/Figma usam token por enquanto; OAuth entra quando os apps forem configurados.
        </p>
      </div>

      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 mb-6">
        <h2 className="font-display text-lg font-semibold">IA personalizada</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Tokens separados dos créditos de geração. Saldo atual: {tokenBalance ?? 0} token(s). Compra mínima 5 e máxima 200 tokens, R$1 por token.
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
                {rows.length === 0 && <div className="text-xs text-muted-foreground">Nenhuma credencial salva.</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
