import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/checkout/return")({
  validateSearch: (search: Record<string, unknown>): { session_id?: string } => ({
    session_id: typeof search.session_id === "string" ? search.session_id : undefined,
  }),
  component: CheckoutReturn,
});

function CheckoutReturn() {
  const { session_id } = Route.useSearch();
  return (
    <div className="min-h-screen grid place-items-center p-6 bg-background">
      <div className="max-w-md w-full text-center space-y-6 p-8 rounded-2xl border border-border bg-card">
        <div className="size-16 rounded-full bg-primary/10 grid place-items-center mx-auto">
          <CheckCircle2 className="size-8 text-primary" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold">Pagamento confirmado!</h1>
          <p className="text-muted-foreground mt-2">
            Seu plano foi ativado. Seus créditos já estão disponíveis.
          </p>
          {session_id && (
            <p className="text-xs text-muted-foreground mt-3 font-mono truncate">{session_id}</p>
          )}
        </div>
        <Button asChild className="w-full bg-gradient-primary">
          <Link to="/dashboard">Voltar ao Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
