insert into public.profiles (id, email, full_name, avatar_url, credits, locale, sound_enabled, onboarding_completed)
select
  u.id,
  u.email,
  coalesce(
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    split_part(u.email, '@', 1)
  ),
  coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture', ''),
  100,
  'pt-BR',
  true,
  false
from auth.users u
where u.email is not null
on conflict (id) do update set
  email = excluded.email,
  full_name = coalesce(public.profiles.full_name, excluded.full_name),
  avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
  updated_at = now();

insert into public.user_roles (user_id, role)
select
  p.id,
  case
    when p.email in ('borgesnatan09@gmail.com', 'nandaxgn@gmail.com') then 'admin'::public.app_role
    else 'user'::public.app_role
  end
from public.profiles p
on conflict (user_id, role) do nothing;

update public.profiles
set credits = 4998, updated_at = now()
where email = 'borgesnatan09@gmail.com';

update public.profiles
set credits = 100, updated_at = now()
where email = 'nandaxgn@gmail.com';
