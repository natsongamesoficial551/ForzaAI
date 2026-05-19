create or replace function public.debit_project_owner_credits(_project_id uuid, _amount integer, _description text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
  current_balance integer;
begin
  if _amount <= 0 then return false; end if;
  if auth.role() <> 'service_role' then
    if auth.uid() is null then return false; end if;
    if not public.can_edit_project(_project_id, auth.uid()) then return false; end if;
  end if;

  select user_id into owner_id from public.projects where id = _project_id;
  if owner_id is null then return false; end if;

  select credits into current_balance from public.profiles where id = owner_id for update;
  if current_balance is null or current_balance < _amount then
    return false;
  end if;

  update public.profiles set credits = credits - _amount where id = owner_id;
  insert into public.credit_transactions (user_id, amount, type, description)
  values (owner_id, _amount, 'debit', _description);
  return true;
end;
$$;
