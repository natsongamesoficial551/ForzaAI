
DROP FUNCTION IF EXISTS public.debit_credits(UUID, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION public.debit_credits(_amount INTEGER, _description TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_balance INTEGER;
  _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN FALSE; END IF;
  IF _amount <= 0 THEN RETURN FALSE; END IF;
  SELECT credits INTO current_balance FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF current_balance IS NULL OR current_balance < _amount THEN
    RETURN FALSE;
  END IF;
  UPDATE public.profiles SET credits = credits - _amount WHERE id = _uid;
  INSERT INTO public.credit_transactions (user_id, amount, type, description)
  VALUES (_uid, _amount, 'debit', _description);
  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.debit_credits(INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.debit_credits(INTEGER, TEXT) TO authenticated;
