import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Check, CreditCard, Loader2, Sparkles, Zap } from "lucide-react";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { getStripeEnvironment } from "@/lib/stripe";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/billing")({ component: Billing });

const CREDIT_PACKAGES = [
  {
    id: "credits_50",
    credits: 50,
    price: "R$50",
    subtitle: "Para ajustes rápidos",
    discount: null,
  },
  {
    id: "credits_100",
    credits: 100,
    price: "R$85",
    subtitle: "Melhor custo para começar",
    discount: "15% OFF",
    highlighted: true,
  },
  {
    id: "credits_300",
    credits: 300,
    price: "R$300",
    subtitle: "Para projetos maiores",
    discount: "Escala Pro",
  },
];

function Billing() {
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [checkout, setCheckout] = useState<{ packageId: string } | null>(null);

  useEffect(() => {
    supabase.auth
      .getUser()
      .then(({ data }) => data.user && setUser({ id: data.user.id, email: data.user.email }));
  }, []);

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("credits").eq("id", user!.id).single();
      return data;
    },
  });

  return (
    <>
      <PaymentTestModeBanner />
      <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto overflow-x-clip">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs text-primary mb-3">
              <Zap className="size-3.5" /> Créditos ForzaAI
            </div>
            <h1 className="font-display text-3xl font-bold">Comprar créditos</h1>
            <p className="text-muted-foreground mt-1">
              Créditos são usados para gerar e modificar sites. Pix e cartão via Stripe.
            </p>
          </div>
          <Link to="/subscriptions">
            <Button variant="outline">
              <Sparkles className="size-4" /> Ver assinaturas
            </Button>
          </Link>
        </div>

        <div className="mt-6 rounded-2xl border border-border bg-card p-5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="size-12 rounded-xl bg-gradient-primary grid place-items-center shadow-glow">
              <Zap className="size-5 text-primary-foreground" />
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Saldo atual</div>
              <div className="text-2xl font-display font-bold">{profile?.credits ?? "—"} créditos</div>
            </div>
          </div>
          <div className="text-sm text-muted-foreground max-w-md">
            Plano gratuito: 25 créditos/mês, 5 créditos diários e 2 extras a cada 5 horas, sem acúmulo.
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-5 mt-8">
          {CREDIT_PACKAGES.map((pack) => (
            <div
              key={pack.id}
              className={cn(
                "relative rounded-3xl border bg-card p-6 transition hover:-translate-y-1 hover:shadow-elegant",
                pack.highlighted ? "border-primary shadow-glow" : "border-border",
              )}
            >
              {pack.discount && (
                <div className="absolute right-4 top-4 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                  {pack.discount}
                </div>
              )}
              <div className="size-12 rounded-2xl bg-primary/10 grid place-items-center mb-5">
                <CreditCard className="size-5 text-primary" />
              </div>
              <h2 className="font-display text-2xl font-bold">{pack.credits} créditos</h2>
              <p className="text-sm text-muted-foreground mt-1">{pack.subtitle}</p>
              <div className="mt-5 text-4xl font-bold">{pack.price}</div>
              <ul className="mt-5 space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <Check className="size-4 text-primary" /> Pagamento por Pix ou cartão
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-4 text-primary" /> Liberação via webhook Stripe
                </li>
              </ul>
              <Button
                className={cn("mt-6 w-full", pack.highlighted && "bg-gradient-primary shadow-glow")}
                variant={pack.highlighted ? "default" : "outline"}
                onClick={() => setCheckout({ packageId: pack.id })}
              >
                Comprar agora
              </Button>
            </div>
          ))}
        </div>

        <Dialog open={!!checkout} onOpenChange={(o) => !o && setCheckout(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Comprar créditos</DialogTitle>
              <DialogDescription>Pagamento seguro com Stripe Pix ou cartão.</DialogDescription>
            </DialogHeader>
            {checkout && user && (
              <StripeEmbeddedCheckout
                packageId={checkout.packageId}
                userId={user.id}
                customerEmail={user.email}
                returnUrl={`${window.location.origin}/checkout/return?session_id={CHECKOUT_SESSION_ID}`}
                mode="credits"
              />
            )}
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
