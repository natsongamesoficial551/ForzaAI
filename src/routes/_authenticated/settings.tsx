import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { Loader2, LogOut, AlertTriangle, Sparkles } from "lucide-react";
import { createSkill, listSkills } from "@/lib/skills.functions";

export const Route = createFileRoute("/_authenticated/settings")({ component: Settings });

function Settings() {
  const qc = useQueryClient();
  const router = useRouter();
  const createSkillFn = useServerFn(createSkill);
  const listSkillsFn = useServerFn(listSkills);
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [fullName, setFullName] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [skillName, setSkillName] = useState("");
  const [skillDescription, setSkillDescription] = useState("");
  const [skillPrompt, setSkillPrompt] = useState("");
  const [notificationPermission, setNotificationPermission] = useState(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported",
  );

  useEffect(() => {
    supabase.auth
      .getUser()
      .then(({ data }) => data.user && setUser({ id: data.user.id, email: data.user.email }));
  }, []);

  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("*").eq("id", user!.id).single();
      if (data) {
        setFullName(data.full_name ?? "");
        setSoundEnabled(data.sound_enabled ?? true);
      }
      return data;
    },
  });

  const { data: skills } = useQuery({
    queryKey: ["skills"],
    queryFn: () => listSkillsFn(),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: fullName, sound_enabled: soundEnabled })
        .eq("id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ajustes salvos");
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createSkillMutation = useMutation({
    mutationFn: async () =>
      createSkillFn({
        data: {
          name: skillName,
          description: skillDescription,
          prompt: skillPrompt,
          isActive: true,
        },
      }),
    onSuccess: () => {
      setSkillName("");
      setSkillDescription("");
      setSkillPrompt("");
      qc.invalidateQueries({ queryKey: ["skills"] });
      toast.success("Skill criada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.navigate({ to: "/" });
  };
  const handleResetPassword = async () => {
    if (!user?.email) return;
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) toast.error(error.message);
    else toast.success("Email de redefinição enviado");
  };

  const handleEnableNotifications = async () => {
    if (!("Notification" in window)) {
      toast.error("Este navegador não suporta notificações.");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission === "granted") toast.success("Notificações ativadas");
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto overflow-x-clip">
      <h1 className="font-display text-3xl font-bold">Ajustes</h1>
      <p className="text-muted-foreground mt-1">Gerencie sua conta e preferências.</p>

      <div className="mt-8 space-y-6">
        <section className="p-6 rounded-xl border border-border bg-card">
          <h2 className="font-display text-lg font-semibold">Perfil</h2>
          <div className="mt-4 flex items-center gap-4">
            <Avatar className="size-16">
              <AvatarImage src={profile?.avatar_url ?? undefined} />
              <AvatarFallback>{fullName.slice(0, 2).toUpperCase() || "U"}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="text-sm text-muted-foreground">{user?.email}</div>
              <div className="text-xs text-muted-foreground mt-1">
                Membro desde{" "}
                {profile?.created_at
                  ? new Date(profile.created_at).toLocaleDateString("pt-BR")
                  : "—"}
              </div>
            </div>
          </div>
          <div className="mt-5">
            <Label htmlFor="name">Nome</Label>
            <Input
              id="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1.5"
              disabled={isLoading}
            />
          </div>
        </section>

        <section className="p-6 rounded-xl border border-border bg-card">
          <h2 className="font-display text-lg font-semibold">Preferências</h2>
          <div className="mt-4 flex items-center justify-between">
            <div>
              <div className="font-medium">Sons da interface</div>
              <div className="text-sm text-muted-foreground">
                Tocar sons em cliques e ao concluir gerações de IA.
              </div>
            </div>
            <Switch checked={soundEnabled} onCheckedChange={setSoundEnabled} />
          </div>
          <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-4">
            <div>
              <div className="font-medium">Notificações do navegador</div>
              <div className="text-sm text-muted-foreground">
                Avisar quando uma geração terminar. Status: {notificationPermission}
              </div>
            </div>
            <Button
              variant="outline"
              onClick={handleEnableNotifications}
              disabled={notificationPermission === "granted" || notificationPermission === "unsupported"}
            >
              {notificationPermission === "granted" ? "Ativadas" : "Ativar"}
            </Button>
          </div>
        </section>

        <div className="flex justify-end">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="bg-gradient-primary"
          >
            {saveMutation.isPending && <Loader2 className="size-4 animate-spin" />}
            Salvar alterações
          </Button>
        </div>

        <section className="p-6 rounded-xl border border-border bg-card">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" />
            <h2 className="font-display text-lg font-semibold">Skills com IA</h2>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Crie comportamentos personalizados para ativar em projetos específicos.
          </p>
          <div className="mt-5 grid gap-3">
            <Input
              value={skillName}
              onChange={(e) => setSkillName(e.target.value)}
              placeholder="Nome da skill"
            />
            <Input
              value={skillDescription}
              onChange={(e) => setSkillDescription(e.target.value)}
              placeholder="Descrição curta"
            />
            <textarea
              value={skillPrompt}
              onChange={(e) => setSkillPrompt(e.target.value)}
              placeholder="Prompt completo da skill"
              className="min-h-28 rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <div className="flex justify-end">
              <Button
                onClick={() => createSkillMutation.mutate()}
                disabled={createSkillMutation.isPending || !skillName.trim() || !skillPrompt.trim()}
              >
                {createSkillMutation.isPending && <Loader2 className="size-4 animate-spin" />}
                Criar skill
              </Button>
            </div>
          </div>
          <div className="mt-5 grid gap-2">
            {(skills ?? []).map((skill: any) => (
              <div key={skill.id} className="rounded-lg border border-border p-3">
                <div className="font-medium text-sm">
                  {skill.name} {skill.is_global && <span className="text-xs text-primary">Global</span>}
                </div>
                <div className="text-xs text-muted-foreground mt-1">{skill.description}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="p-6 rounded-xl border border-border bg-card">
          <h2 className="font-display text-lg font-semibold">Segurança</h2>
          <div className="mt-4 space-y-3">
            <Button variant="outline" onClick={handleResetPassword}>
              Redefinir senha por email
            </Button>
            <Button
              variant="outline"
              onClick={handleLogout}
              className="text-destructive hover:text-destructive"
            >
              <LogOut className="size-4" /> Sair da conta
            </Button>
          </div>
        </section>

        <section className="p-6 rounded-xl border border-destructive/30 bg-destructive/5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <h2 className="font-display text-lg font-semibold text-destructive">Excluir conta</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Entre em contato com o suporte para excluir permanentemente sua conta.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
