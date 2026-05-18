-- ============ Roles ============
create type public.app_role as enum ('admin', 'user');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.is_admin(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(_user_id, 'admin'::public.app_role)
$$;

create policy "users see own roles" on public.user_roles
  for select using (auth.uid() = user_id);
create policy "admins see all roles" on public.user_roles
  for select using (public.is_admin(auth.uid()));
create policy "admins manage roles" on public.user_roles
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ============ Subscriptions ============
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_subscription_id text not null unique,
  stripe_customer_id text not null,
  product_id text not null,
  price_id text not null,
  status text not null default 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean default false,
  environment text not null default 'sandbox',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_subscriptions_user_id on public.subscriptions(user_id);
create index idx_subscriptions_stripe_id on public.subscriptions(stripe_subscription_id);

alter table public.subscriptions enable row level security;

create policy "users view own subscription" on public.subscriptions
  for select using (auth.uid() = user_id);
create policy "admins view all subscriptions" on public.subscriptions
  for select using (public.is_admin(auth.uid()));
create policy "service role manages subscriptions" on public.subscriptions
  for all using (auth.role() = 'service_role');

create trigger update_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.update_updated_at_column();

create or replace function public.has_active_subscription(_user_id uuid, _env text default 'sandbox')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.subscriptions
    where user_id = _user_id
      and environment = _env
      and (
        (status in ('active','trialing') and (current_period_end is null or current_period_end > now()))
        or (status = 'canceled' and current_period_end > now())
      )
  )
$$;

create or replace function public.get_user_plan(_user_id uuid, _env text default 'sandbox')
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
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
$$;

create or replace function public.refill_monthly_credits(_user_id uuid, _plan text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare new_amount integer;
begin
  new_amount := case _plan
    when 'business' then 5000
    when 'pro' then 1000
    else 100
  end;
  update public.profiles set credits = new_amount where id = _user_id;
  insert into public.credit_transactions (user_id, amount, type, description)
  values (_user_id, new_amount, 'credit', 'Plan refill: ' || _plan);
  return new_amount;
end;
$$;

-- ============ Admin grant on signup ============
create or replace function public.assign_admin_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email = 'borgesnatan09@gmail.com' then
    insert into public.user_roles (user_id, role) values (new.id, 'admin')
    on conflict do nothing;
  else
    insert into public.user_roles (user_id, role) values (new.id, 'user')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists assign_admin_on_signup on public.profiles;
create trigger assign_admin_on_signup
  after insert on public.profiles
  for each row execute function public.assign_admin_on_signup();

-- Backfill: existing users
insert into public.user_roles (user_id, role)
select id, case when email = 'borgesnatan09@gmail.com' then 'admin'::public.app_role else 'user'::public.app_role end
from public.profiles
on conflict do nothing;