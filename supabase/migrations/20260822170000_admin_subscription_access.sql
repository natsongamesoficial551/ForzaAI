-- Admins devem ter acesso completo aos recursos de assinatura, sem depender
-- de registro Stripe real. Mantém a assinatura comercial normal para usuários.

create or replace function public.has_active_subscription(_user_id uuid default auth.uid(), _env text default 'sandbox')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.is_admin(_user_id), false)
    or exists (
      select 1 from public.subscriptions
      where user_id = _user_id
        and environment = _env
        and (
          (status in ('active','trialing') and (current_period_end is null or current_period_end > now()))
          or (status = 'canceled' and current_period_end > now())
        )
    )
$$;

create or replace function public.get_user_plan(_user_id uuid default auth.uid(), _env text default 'sandbox')
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce(public.is_admin(_user_id), false) then 'business'
    else coalesce(
      (select case
        when price_id = 'business_monthly' then 'business'
        when price_id = 'pro_monthly' then 'pro'
        else 'free'
      end
      from public.subscriptions
      where user_id = _user_id
        and environment = _env
        and status in ('active','trialing','past_due')
        and (current_period_end is null or current_period_end > now())
      order by created_at desc
      limit 1), 'free')
  end
$$;
