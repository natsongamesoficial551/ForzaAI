import { createFileRoute, Link } from "@tanstack/react-router";
import { UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/profile")({ component: Profile });

function Profile() {
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="rounded-3xl border border-border bg-card p-8 shadow-elegant">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs text-primary">
          <UserRound className="size-3.5" /> Perfil
        </div>
        <h1 className="font-display text-3xl font-bold mt-4">Seu perfil</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl">
          Preferências, idioma, notificações e sons continuarão sendo configurados em Ajustes até a
          página completa de perfil ser liberada.
        </p>
        <Link to="/settings" className="inline-block mt-6">
          <Button variant="outline">Abrir ajustes</Button>
        </Link>
      </div>
    </div>
  );
}
