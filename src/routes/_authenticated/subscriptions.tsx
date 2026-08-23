import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Check, Crown, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";
import { supabase } from "@/integrations/supabase/client";
import { createPortalSession } from "@/lib/payments.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/subscriptions")({ component: Subscriptions });

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "R$0",
    priceId: null,
    features: ["25 créditos/mês", "5 créditos diários", "2 extras a cada 5h", "Subdomínio público"],
  },
  {
    id: "pro",
    name: "Pro",
    price: "R$19/mês",
    priceId: "pro_monthly",
    highlighted: true,
    features: ["1.000 créditos/mês", "Modelos Pro", "Mais intensidade de IA", "Suporte por email"],
  },
  {
    id: "business",
    name: "Business",
    price: "R$49/mês",
    priceId: "business_monthly",
    features: ["5.000 créditos/mês", "Prioridade", "Colaboração avançada", "Modelos premium"],
  },
];

function Subscriptions() {
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
      <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto overflow-x-clip">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs text-primary mb-3">
              <Crown className="size-3.5" /> Assinaturas
            </div>
            <h1 className="font-display text-3xl font-bold">Planos ForzaAI</h1>
            <p className="text-muted-foreground mt-1">
              Cancele quando quiser. O acesso continua ativo até o final do período pago.
            </p>
          </div>
          {currentPlanId !== "free" && (
            <Button variant="outline" onClick={() => portalMutation.mutate()} disabled={portalMutation.isPending}>
              {portalMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
              Gerenciar ou cancelar
            </Button>
          )}
        </div>

        {subscription?.cancel_at_period_end && subscription.current_period_end && (
          <div className="mt-6 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm">
            Sua assinatura foi cancelada e continua ativa até {new Date(subscription.current_period_end).toLocaleDateString("pt-BR")}.
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-5 mt-8">
          {PLANS.map((plan) => {
            const isCurrent = currentPlanId === plan.id;
            return (
              <div
                key={plan.id}
                className={cn(
                  "rounded-3xl border bg-card p-6 flex flex-col",
                  plan.highlighted ? "border-primary shadow-glow" : "border-border",
                )}
              >
                {plan.highlighted && <div className="text-xs text-primary font-semibold mb-2">Mais popular</div>}
                <h2 className="font-display text-2xl font-bold">{plan.name}</h2>
                <div className="mt-3 text-4xl font-bold">{plan.price}</div>
                <ul className="mt-6 space-y-2 flex-1">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm">
                      <Check className="size-4 text-primary shrink-0 mt-0.5" /> {feature}
                    </li>
                  ))}
                </ul>
                <Button
                  className={cn("mt-6 w-full", plan.highlighted && !isCurrent && "bg-gradient-primary shadow-glow")}
                  variant={isCurrent ? "outline" : plan.highlighted ? "default" : "outline"}
                  disabled={isCurrent || !plan.priceId}
                  onClick={() => plan.priceId && setCheckout({ priceId: plan.priceId })}
                >
                  {isCurrent ? "Plano atual" : plan.priceId ? "Assinar" : "Grátis"}
                </Button>
              </div>
            );
          })}
        </div>

        <Dialog open={!!checkout} onOpenChange={(o) => !o && setCheckout(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Finalizar assinatura</DialogTitle>
              <DialogDescription>Pagamento seguro com Stripe.</DialogDescription>
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
