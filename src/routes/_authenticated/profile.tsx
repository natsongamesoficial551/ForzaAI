import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Camera, Loader2, Save, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/profile")({ component: Profile });

function Profile() {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    full_name: "",
    avatar_url: "",
    recovery_phone: "",
    bio: "",
  });

  const { data: user } = useQuery({
    queryKey: ["auth-user"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user;
    },
  });

  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile-page", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, first_name, last_name, full_name, avatar_url, recovery_phone, bio")
        .eq("id", user!.id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!profile) return;
    const [fallbackFirst = "", ...rest] = (profile.full_name ?? "").split(" ").filter(Boolean);
    setForm({
      first_name: profile.first_name ?? fallbackFirst,
      last_name: profile.last_name ?? rest.join(" "),
      full_name: profile.full_name ?? "",
      avatar_url: profile.avatar_url ?? "",
      recovery_phone: profile.recovery_phone ?? "",
      bio: profile.bio ?? "",
    });
  }, [profile]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Usuário não autenticado");
      const first = form.first_name.trim();
      const last = form.last_name.trim();
      const fullName = [first, last].filter(Boolean).join(" ") || form.full_name.trim();
      const { error } = await supabase
        .from("profiles")
        .update({
          first_name: first,
          last_name: last,
          full_name: fullName,
          avatar_url: form.avatar_url.trim(),
          recovery_phone: form.recovery_phone.trim(),
          bio: form.bio.trim(),
        })
        .eq("id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile-page", user?.id] });
      qc.invalidateQueries({ queryKey: ["profile", user?.id] });
      toast.success("Perfil atualizado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const initials = (form.first_name || profile?.full_name || user?.email || "U").slice(0, 2).toUpperCase();

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto overflow-x-clip">
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs text-primary">
          <UserRound className="size-3.5" /> Perfil
        </div>
        <h1 className="font-display text-3xl font-bold mt-4">Seu perfil</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl">
          Atualize seus dados públicos e informações de recuperação da conta.
        </p>
      </div>

      <div className="grid lg:grid-cols-[320px_1fr] gap-6">
        <div className="rounded-3xl border border-border bg-card p-6 shadow-elegant h-fit">
          <Avatar className="size-28 mx-auto border border-border">
            <AvatarImage src={form.avatar_url || undefined} />
            <AvatarFallback className="text-2xl">{initials}</AvatarFallback>
          </Avatar>
          <div className="text-center mt-4">
            <h2 className="font-display text-xl font-semibold">{form.first_name || profile?.full_name || "Usuário ForzaAI"}</h2>
            <p className="text-sm text-muted-foreground mt-1">{profile?.email ?? user?.email}</p>
          </div>
          <div className="mt-5 rounded-2xl border border-border bg-background/60 p-4 text-sm text-muted-foreground">
            <Camera className="size-4 text-primary mb-2" />
            Cole a URL de uma imagem segura no campo de foto para trocar seu avatar.
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-card p-6 shadow-elegant">
          {isLoading ? (
            <div className="h-72 rounded-2xl bg-muted/40 animate-pulse" />
          ) : (
            <div className="space-y-5">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Nome</label>
                  <Input value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} className="mt-1.5" />
                </div>
                <div>
                  <label className="text-sm font-medium">Sobrenome</label>
                  <Input value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} className="mt-1.5" />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium">URL da foto</label>
                <Input value={form.avatar_url} onChange={(e) => setForm((f) => ({ ...f, avatar_url: e.target.value }))} placeholder="https://..." className="mt-1.5" />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">E-mail</label>
                  <Input value={profile?.email ?? user?.email ?? ""} disabled className="mt-1.5" />
                </div>
                <div>
                  <label className="text-sm font-medium">Telefone de recuperação</label>
                  <Input value={form.recovery_phone} onChange={(e) => setForm((f) => ({ ...f, recovery_phone: e.target.value }))} placeholder="+55 11 99999-9999" className="mt-1.5" />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium">Bio curta</label>
                <textarea
                  value={form.bio}
                  onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
                  rows={4}
                  maxLength={240}
                  placeholder="Conte algo rápido sobre você ou sua empresa."
                  className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>

              <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending} className="bg-gradient-primary shadow-glow">
                {updateMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Salvar perfil
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
