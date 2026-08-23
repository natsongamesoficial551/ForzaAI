-- Remove overload legado que aceitava apenas uuid. Ele não considera admin e
-- pode ser escolhido pelo PostgREST quando o app envia só _user_id, deixando
-- modelos Pro bloqueados mesmo com get_user_plan = business.
drop function if exists public.has_active_subscription(uuid);
