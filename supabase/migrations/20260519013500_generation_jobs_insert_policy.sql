create policy "users create own generation jobs" on public.generation_jobs
  for insert with check (user_id = auth.uid());
