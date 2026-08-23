import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getAdminMetrics, checkIsAdmin, listAiProviderSettings, saveAiProviderSetting } from "@/lib/admin.functions";
import {
  DollarSign,
  Users,
  FolderKanban,
  TrendingUp,
  Loader2,
  Crown,
  Zap,
  ShieldOff,
  Globe,
  Brain,
  Save,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({ component: Admin });

type AiProviderSetting = {
  id?: string;
  forzaModelId: string;
  provider: string;
  label: string;
  endpoint: string;
  upstreamModel: string;
  apiKey?: string;
  hasApiKey?: boolean;
  requiresSubscription: boolean;
  creditMultiplier: number;
  isEnabled: boolean;
};

function Admin() {
  const metricsFn = useServerFn(getAdminMetrics);
  const adminFn = useServerFn(checkIsAdmin);
  const listAiSettingsFn = useServerFn(listAiProviderSettings);
  const saveAiSettingFn = useServerFn(saveAiProviderSetting);
  const queryClient = useQueryClient();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [aiSettingsDraft, setAiSettingsDraft] = useState<Record<string, AiProviderSetting>>({});

  useEffect(() => {
    adminFn({})
      .then((r) => setAuthorized(r.isAdmin))
      .catch(() => setAuthorized(false));
  }, [adminFn]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-metrics"],
    enabled: authorized === true,
    queryFn: () => metricsFn({}),
  });

  const { data: aiSettings } = useQuery({
    queryKey: ["admin-ai-provider-settings"],
    enabled: authorized === true,
    queryFn: () => listAiSettingsFn({}),
  });

  useEffect(() => {
    if (!aiSettings) return;
    setAiSettingsDraft(
      Object.fromEntries(
        aiSettings.map((setting: AiProviderSetting) => [
          setting.forzaModelId,
          { ...setting, apiKey: "" },
        ]),
      ),
    );
  }, [aiSettings]);

  const saveAiMutation = useMutation({
    mutationFn: (setting: AiProviderSetting) => saveAiSettingFn({ data: setting }),
    onSuccess: () => {
      toast.success("Configuração de IA salva");
      queryClient.invalidateQueries({ queryKey: ["admin-ai-provider-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (authorized === false) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-md mx-auto text-center mt-12 sm:mt-20 overflow-x-clip">
        <div className="size-14 rounded-full bg-destructive/10 grid place-items-center mx-auto">
          <ShieldOff className="size-7 text-destructive" />
        </div>
        <h1 className="font-display text-2xl font-bold mt-4">Acesso restrito</h1>
        <p className="text-muted-foreground mt-2">Este painel é apenas para administradores.</p>
        <Link to="/dashboard" className="inline-block mt-6 text-primary underline">
          Voltar ao Painel
        </Link>
      </div>
    );
  }

  if (authorized === null || isLoading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 grid place-items-center min-h-[50vh] overflow-x-clip">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 text-destructive overflow-x-clip">
        Erro: {(error as Error)?.message ?? "desconhecido"}
      </div>
    );
  }

  const maxSignups = Math.max(1, ...data.series.map((s) => s.signups));

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto overflow-x-clip">
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-lg bg-gradient-primary grid place-items-center shadow-glow">
          <Crown className="size-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="font-display text-3xl font-bold">Admin · Visão geral</h1>
          <p className="text-muted-foreground text-sm">Métricas globais do SaaS.</p>
        </div>
      </div>

      <div className="grid md:grid-cols-4 gap-4 mt-8">
        <Stat
          icon={<DollarSign className="size-5" />}
          label="MRR"
          value={`$${data.mrr.toLocaleString()}`}
          sub={`$${data.arr.toLocaleString()} ARR`}
          highlighted
        />
        <Stat
          icon={<Users className="size-5" />}
          label="Usuários"
          value={data.totalUsers.toLocaleString()}
          sub={`${data.activeSubscriptions} pagantes`}
        />
        <Stat
          icon={<FolderKanban className="size-5" />}
          label="Projetos"
          value={data.totalProjects.toLocaleString()}
          sub={`${data.publishedProjects} publicados`}
        />
        <Stat
          icon={<Zap className="size-5" />}
          label="Créditos (30d)"
          value={data.creditsConsumed30d.toLocaleString()}
          sub="consumidos"
        />
      </div>

      <div className="grid md:grid-cols-3 gap-4 mt-4">
        <MiniCard
          label="Assinaturas Pro"
          value={data.proCount}
          sub={`$${(data.proCount * 19).toLocaleString()}/mês`}
        />
        <MiniCard
          label="Assinaturas Business"
          value={data.businessCount}
          sub={`$${(data.businessCount * 49).toLocaleString()}/mês`}
        />
        <MiniCard
          label="Conversão Free→Pago"
          value={`${data.totalUsers > 0 ? ((data.activeSubscriptions / data.totalUsers) * 100).toFixed(1) : "0"}%`}
          sub={`${data.activeSubscriptions} de ${data.totalUsers}`}
        />
      </div>

      <div className="mt-6 p-6 rounded-xl border border-border bg-card">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="size-4 text-primary" />
          <h3 className="font-display font-semibold">Cadastros nos últimos 30 dias</h3>
        </div>
        <div className="flex items-end gap-1 h-32">
          {data.series.map((s) => (
            <div key={s.date} className="flex-1" title={`${s.date}: ${s.signups}`}>
              <div
                className="w-full bg-primary/30 hover:bg-primary/60 rounded-t transition-colors"
                style={{
                  height: `${(s.signups / maxSignups) * 100}%`,
                  minHeight: s.signups > 0 ? "4px" : "0",
                }}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-xs text-muted-foreground mt-2">
          <span>{data.series[0]?.date.slice(5)}</span>
          <span>{data.series[data.series.length - 1]?.date.slice(5)}</span>
        </div>
      </div>

      <div className="mt-6 p-6 rounded-xl border border-border bg-card">
        <h3 className="font-display font-semibold flex items-center gap-2 mb-4">
          <Globe className="size-4 text-primary" /> Últimos usuários
        </h3>
        <div className="space-y-1">
          {data.recentUsers.map((u: any) => (
            <div
              key={u.id}
              className="flex items-center justify-between py-2 px-3 rounded hover:bg-secondary/50 text-sm"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{u.full_name || u.email}</div>
                <div className="text-xs text-muted-foreground truncate">{u.email}</div>
              </div>
              <div className="text-xs text-muted-foreground shrink-0 ml-3">
                {u.credits} créditos · {new Date(u.created_at).toLocaleDateString("pt-BR")}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 p-6 rounded-xl border border-border bg-card">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="font-display font-semibold flex items-center gap-2">
              <Brain className="size-4 text-primary" /> Modelos de IA
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Configure apenas APIs oficiais/autorizadas. Assinaturas pessoais de app/ChatGPT/Codex não são API backend.
            </p>
          </div>
        </div>
        <div className="grid gap-4">
          {Object.values(aiSettingsDraft).map((setting) => (
            <div key={setting.forzaModelId} className="rounded-xl border border-border bg-background/50 p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <div className="font-medium">{setting.label}</div>
                  <div className="text-xs text-muted-foreground">{setting.forzaModelId}</div>
                </div>
                <button
                  type="button"
                  onClick={() => saveAiMutation.mutate(setting)}
                  disabled={saveAiMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-60"
                >
                  <Save className="size-3.5" /> Salvar
                </button>
              </div>
              <div className="grid md:grid-cols-2 gap-3 text-sm">
                <AdminField label="Nome">
                  <input
                    value={setting.label}
                    onChange={(event) =>
                      setAiSettingsDraft((current) => ({
                        ...current,
                        [setting.forzaModelId]: { ...setting, label: event.target.value },
                      }))
                    }
                    className="w-full rounded-md border border-border bg-background px-3 py-2"
                  />
                </AdminField>
                <AdminField label="Provider">
                  <select
                    value={setting.provider}
                    onChange={(event) =>
                      setAiSettingsDraft((current) => ({
                        ...current,
                        [setting.forzaModelId]: { ...setting, provider: event.target.value },
                      }))
                    }
                    className="w-full rounded-md border border-border bg-background px-3 py-2"
                  >
                    <option value="9router">9router</option>
                  </select>
                </AdminField>
                <AdminField label="Endpoint">
                  <input
                    value={setting.endpoint}
                    onChange={(event) =>
                      setAiSettingsDraft((current) => ({
                        ...current,
                        [setting.forzaModelId]: { ...setting, endpoint: event.target.value },
                      }))
                    }
                    className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
                  />
                </AdminField>
                <AdminField label="Modelo upstream">
                  <input
                    value={setting.upstreamModel}
                    onChange={(event) =>
                      setAiSettingsDraft((current) => ({
                        ...current,
                        [setting.forzaModelId]: { ...setting, upstreamModel: event.target.value },
                      }))
                    }
                    className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
                  />
                </AdminField>
                <AdminField label={setting.hasApiKey ? "Nova API key (opcional)" : "API key"}>
                  <input
                    value={setting.apiKey ?? ""}
                    onChange={(event) =>
                      setAiSettingsDraft((current) => ({
                        ...current,
                        [setting.forzaModelId]: { ...setting, apiKey: event.target.value },
                      }))
                    }
                    type="password"
                    placeholder={setting.hasApiKey ? "Manter chave atual" : "Cole a chave oficial do provedor"}
                    className="w-full rounded-md border border-border bg-background px-3 py-2"
                  />
                </AdminField>
                <AdminField label="Multiplicador de créditos">
                  <input
                    value={setting.creditMultiplier}
                    onChange={(event) =>
                      setAiSettingsDraft((current) => ({
                        ...current,
                        [setting.forzaModelId]: { ...setting, creditMultiplier: Number(event.target.value) },
                      }))
                    }
                    type="number"
                    min="0.1"
                    step="0.1"
                    className="w-full rounded-md border border-border bg-background px-3 py-2"
                  />
                </AdminField>
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={setting.requiresSubscription}
                    onChange={(event) =>
                      setAiSettingsDraft((current) => ({
                        ...current,
                        [setting.forzaModelId]: { ...setting, requiresSubscription: event.target.checked },
                      }))
                    }
                  />
                  Requer assinatura Pro
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={setting.isEnabled}
                    onChange={(event) =>
                      setAiSettingsDraft((current) => ({
                        ...current,
                        [setting.forzaModelId]: { ...setting, isEnabled: event.target.checked },
                      }))
                    }
                  />
                  Ativo
                </label>
              </div>
            </div>
          ))}
          {Object.keys(aiSettingsDraft).length === 0 && (
            <div className="text-sm text-muted-foreground">Rode a migration de configurações de IA para carregar os modelos.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function AdminField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  highlighted,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  highlighted?: boolean;
}) {
  return (
    <div
      className={`p-5 rounded-xl border bg-card ${highlighted ? "border-primary shadow-glow" : "border-border"}`}
    >
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={highlighted ? "text-primary" : "text-muted-foreground"}>{icon}</div>
      </div>
      <div className="font-display text-3xl font-bold mt-2">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function MiniCard({ label, value, sub }: { label: string; value: string | number; sub: string }) {
  return (
    <div className="p-5 rounded-xl border border-border bg-card">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-display text-2xl font-bold mt-1">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{sub}</div>
    </div>
  );
}
