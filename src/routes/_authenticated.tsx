import {
  createFileRoute,
  redirect,
  Outlet,
  Link,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Sparkles,
  LayoutDashboard,
  FolderKanban,
  CreditCard,
  Settings,
  LogOut,
  Zap,
  Crown,
  Globe2,
  Plug,
  UserRound,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/login", search: { redirect: location.href } as never });
    }
  },
  component: AuthLayout,
});

function AuthLayout() {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [user, setUser] = useState<{ email?: string; id?: string } | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("*").eq("id", user!.id!).single();
      return data;
    },
  });

  const { data: roleData } = useQuery({
    queryKey: ["role", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id!)
        .eq("role", "admin")
        .maybeSingle();
      return { isAdmin: !!data };
    },
  });

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.navigate({ to: "/" });
  };

  const nav = [
    { to: "/dashboard", icon: LayoutDashboard, label: "Painel" },
    { to: "/projects", icon: FolderKanban, label: "Projetos" },
    { to: "/billing", icon: CreditCard, label: "Créditos" },
    { to: "/subscriptions", icon: Crown, label: "Assinaturas" },
    { to: "/domains", icon: Globe2, label: "Domínios" },
    { to: "/connectors", icon: Plug, label: "Conectores" },
    { to: "/settings", icon: Settings, label: "Configurações" },
    { to: "/profile", icon: UserRound, label: "Perfil" },
  ];
  if (roleData?.isAdmin) {
    nav.push({ to: "/admin", icon: Crown, label: "Admin" });
  }

  const isWorkspace = pathname.includes("/projects/") && pathname.split("/").length > 3;

  return (
    <div className="min-h-screen flex bg-background">
      {/* sidebar */}
      <aside className="w-60 border-r border-border bg-sidebar flex flex-col shrink-0">
        <Link
          to="/dashboard"
          className="h-16 flex items-center gap-2 px-5 border-b border-sidebar-border"
        >
          <div className="size-8 rounded-lg bg-gradient-primary shadow-glow grid place-items-center">
            <Sparkles className="size-4 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <span className="font-display font-bold leading-none">ForzaAI</span>
            <div className="text-[10px] text-muted-foreground leading-none mt-1">Estúdio SaaS</div>
          </div>
        </Link>

        <nav className="flex-1 p-3 space-y-1">
          {nav.map((item) => {
            const active =
              pathname === item.to || (item.to !== "/dashboard" && pathname.startsWith(item.to));
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-xl text-sm whitespace-nowrap overflow-hidden transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                )}
              >
                <item.icon className="size-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-sidebar-border">
          <div className="px-3 py-2 rounded-md bg-card flex items-center gap-2 mb-2">
            <Zap className="size-4 text-accent" />
            <span className="text-sm font-medium">{profile?.credits ?? "—"}</span>
            <span className="text-xs text-muted-foreground">créditos</span>
          </div>
          <div className="flex items-center gap-2 px-2 py-2">
            <Avatar className="size-7">
              <AvatarImage src={profile?.avatar_url ?? undefined} />
              <AvatarFallback className="text-xs">
                {profile?.full_name?.slice(0, 2).toUpperCase() ?? "U"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">
                {profile?.full_name ?? user?.email}
              </div>
            </div>
            <Button size="icon" variant="ghost" onClick={handleLogout} className="size-7">
              <LogOut className="size-3.5" />
            </Button>
          </div>
        </div>
      </aside>

      {/* main */}
      <main className={cn("flex-1 min-w-0", isWorkspace ? "" : "overflow-auto")}>
        <Outlet />
      </main>
    </div>
  );
}
