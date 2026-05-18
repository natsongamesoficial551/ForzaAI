import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function ensureAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("is_admin", { _user_id: userId });
  if (error || !data) throw new Error("Forbidden");
}

export const getAdminMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context.supabase, context.userId);

    const [usersRes, subsRes, projectsRes, publishedRes, txRes] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, email, full_name, credits, created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .limit(100),
      supabaseAdmin
        .from("subscriptions")
        .select("user_id, price_id, status, current_period_end, environment, created_at")
        .order("created_at", { ascending: false }),
      supabaseAdmin.from("projects").select("id", { count: "exact", head: true }),
      supabaseAdmin
        .from("projects")
        .select("id", { count: "exact", head: true })
        .eq("status", "published"),
      supabaseAdmin
        .from("credit_transactions")
        .select("amount, type, created_at")
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

    const subs = subsRes.data ?? [];
    const active = subs.filter(
      (s: any) =>
        ["active", "trialing"].includes(s.status) &&
        (!s.current_period_end || new Date(s.current_period_end) > new Date()),
    );
    const priceAmount: Record<string, number> = { pro_monthly: 19, business_monthly: 49 };
    const mrr = active.reduce((sum: number, s: any) => sum + (priceAmount[s.price_id] ?? 0), 0);
    const proCount = active.filter((s: any) => s.price_id === "pro_monthly").length;
    const businessCount = active.filter((s: any) => s.price_id === "business_monthly").length;

    // signup last 30 days timeseries
    const users = usersRes.data ?? [];
    const now = new Date();
    const series: { date: string; signups: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const count = users.filter((u: any) => u.created_at.slice(0, 10) === key).length;
      series.push({ date: key, signups: count });
    }

    return {
      totalUsers: usersRes.count ?? users.length,
      totalProjects: projectsRes.count ?? 0,
      publishedProjects: publishedRes.count ?? 0,
      mrr,
      arr: mrr * 12,
      activeSubscriptions: active.length,
      proCount,
      businessCount,
      recentUsers: users.slice(0, 20),
      series,
      creditsConsumed30d: (txRes.data ?? [])
        .filter(
          (t: any) =>
            t.type === "debit" && new Date(t.created_at) > new Date(Date.now() - 30 * 86400000),
        )
        .reduce((s: number, t: any) => s + Math.abs(t.amount), 0),
    };
  });

export const checkIsAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.rpc("is_admin", { _user_id: context.userId });
    return { isAdmin: Boolean(data) };
  });
