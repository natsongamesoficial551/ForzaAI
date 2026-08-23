import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/dashboard" });
  },
  component: Login,
});

function Login() {
  const [loading, setLoading] = useState(false);

  const handleGoogle = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin + "/dashboard",
        },
      });
      if (error) {
        toast.error("Falha ao entrar com Google");
        setLoading(false);
        return;
      }
    } catch {
      toast.error("Erro inesperado");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh grid place-items-center px-4 sm:px-6 py-8 relative overflow-x-hidden overflow-y-auto">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_var(--primary)_0%,_transparent_50%)] opacity-15" />

      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2 justify-center mb-8 sm:mb-10">
          <div className="size-10 rounded-lg bg-gradient-primary shadow-glow grid place-items-center">
            <Sparkles className="size-5 text-primary-foreground" />
          </div>
          <span className="font-display font-bold text-2xl">ForzaAI</span>
        </Link>

        <div className="rounded-2xl border border-border bg-card p-5 sm:p-8 shadow-elegant">
          <h1 className="font-display text-2xl font-semibold text-center">Bem-vindo</h1>
          <p className="text-center text-sm text-muted-foreground mt-2">
            Entre com Google para começar a criar
          </p>

          <Button
            onClick={handleGoogle}
            disabled={loading}
            size="lg"
            variant="outline"
            className="w-full mt-8 h-12 text-base"
          >
            {loading ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <>
                <GoogleIcon /> Continuar com Google
              </>
            )}
          </Button>

          <p className="mt-6 text-xs text-center text-muted-foreground">
            Ao continuar você aceita nossos termos. GitHub em breve.
          </p>
        </div>

        <Link
          to="/"
          className="block text-center text-sm text-muted-foreground mt-6 hover:text-foreground transition-colors"
        >
          ← Voltar
        </Link>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5">
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.2 1.4-1.6 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.5 14.5 2.5 12 2.5 6.8 2.5 2.6 6.7 2.6 12s4.2 9.5 9.4 9.5c5.4 0 9-3.8 9-9.2 0-.6-.1-1.1-.2-1.6H12z"
      />
    </svg>
  );
}
