import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getAdminMetrics, checkIsAdmin } from "@/lib/admin.functions";
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
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({ component: Admin });

function Admin() {
  const metricsFn = useServerFn(getAdminMetrics);
  const adminFn = useServerFn(checkIsAdmin);
  const [authorized, setAuthorized] = useState<boolean | null>(null);

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

  if (authorized === false) {
    return (
      <div className="p-8 max-w-md mx-auto text-center mt-20">
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
      <div className="p-8 grid place-items-center min-h-[50vh]">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 text-destructive">
        Erro: {(error as Error)?.message ?? "desconhecido"}
      </div>
    );
  }

  const maxSignups = Math.max(1, ...data.series.map((s) => s.signups));

  return (
    <div className="p-8 max-w-7xl mx-auto">
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
    </div>
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
