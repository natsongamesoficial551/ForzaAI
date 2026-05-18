import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Check, Zap, Loader2, ExternalLink, Crown } from "lucide-react";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { createPortalSession } from "@/lib/payments.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/billing")({ component: Billing });

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: 0,
    priceId: null,
    features: [
      "100 créditos/mês",
      "Sites ilimitados",
      "Subdomínio /s/seu-site",
      "Suporte da comunidade",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: 19,
    priceId: "pro_monthly",
    highlighted: true,
    features: [
      "1.000 créditos/mês",
      "Tudo do Free",
      "Geração de imagens com IA",
      "Suporte por email",
    ],
  },
  {
    id: "business",
    name: "Business",
    price: 49,
    priceId: "business_monthly",
    features: ["5.000 créditos/mês", "Tudo do Pro", "Prioridade na fila", "Modelos premium"],
  },
];

function Billing() {
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [checkout, setCheckout] = useState<{ priceId: string } | null>(null);
  const portalFn = useServerFn(createPortalSession);

  useEffect(() => {
    supabase.auth
      .getUser()
      .then(({ data }) => data.user && setUser({ id: data.user.id, email: data.user.email }));
  }, []);

  const { data: subscription } = useQuery({
    queryKey: ["subscription", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", user!.id)
        .eq("environment", getStripeEnvironment())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("credits")
        .eq("id", user!.id)
        .single();
      return data;
    },
  });

  const currentPlanId =
    subscription?.price_id === "business_monthly"
      ? "business"
      : subscription?.price_id === "pro_monthly"
        ? "pro"
        : "free";

  const portalMutation = useMutation({
    mutationFn: async () => {
      const url = await portalFn({
        data: { environment: getStripeEnvironment(), returnUrl: window.location.href },
      });
      window.open(url, "_blank");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <PaymentTestModeBanner />
      <div className="p-8 max-w-5xl mx-auto">
        <h1 className="font-display text-3xl font-bold">Planos e cobrança</h1>
        <p className="text-muted-foreground mt-1">Escolha o plano ideal para você.</p>

        <div className="mt-6 rounded-xl border border-border bg-card p-5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="size-12 rounded-lg bg-gradient-primary grid place-items-center shadow-glow">
              <Zap className="size-5 text-primary-foreground" />
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Saldo atual</div>
              <div className="text-2xl font-display font-bold">
                {profile?.credits ?? "—"} créditos
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Plano atual</div>
              <div className="font-semibold capitalize flex items-center gap-1.5">
                {currentPlanId !== "free" && <Crown className="size-4 text-accent" />}
                {currentPlanId}
              </div>
            </div>
            {currentPlanId !== "free" && (
              <Button
                variant="outline"
                onClick={() => portalMutation.mutate()}
                disabled={portalMutation.isPending}
              >
                {portalMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ExternalLink className="size-4" />
                )}
                Gerenciar
              </Button>
            )}
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-4 mt-6">
          {PLANS.map((plan) => {
            const isCurrent = currentPlanId === plan.id;
            return (
              <div
                key={plan.id}
                className={cn(
                  "p-6 rounded-xl border bg-card flex flex-col",
                  plan.highlighted ? "border-primary shadow-glow" : "border-border",
                )}
              >
                {plan.highlighted && (
                  <div className="text-xs font-medium text-primary -mt-2 mb-2 uppercase tracking-wider">
                    Mais popular
                  </div>
                )}
                <div className="font-display text-xl font-bold">{plan.name}</div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-bold">${plan.price}</span>
                  <span className="text-sm text-muted-foreground">/mês</span>
                </div>
                <ul className="mt-5 space-y-2 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check className="size-4 text-primary shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  className={cn(
                    "mt-6 w-full",
                    plan.highlighted && !isCurrent && "bg-gradient-primary shadow-glow",
                  )}
                  variant={isCurrent ? "outline" : plan.highlighted ? "default" : "outline"}
                  disabled={isCurrent || !plan.priceId}
                  onClick={() => plan.priceId && setCheckout({ priceId: plan.priceId })}
                >
                  {isCurrent ? "Plano atual" : plan.price === 0 ? "Grátis" : "Assinar"}
                </Button>
              </div>
            );
          })}
        </div>

        <Dialog open={!!checkout} onOpenChange={(o) => !o && setCheckout(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Finalizar assinatura</DialogTitle>
              <DialogDescription>Pagamento seguro.</DialogDescription>
            </DialogHeader>
            {checkout && user && (
              <StripeEmbeddedCheckout
                priceId={checkout.priceId}
                userId={user.id}
                customerEmail={user.email}
                returnUrl={`${window.location.origin}/checkout/return?session_id={CHECKOUT_SESSION_ID}`}
              />
            )}
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
