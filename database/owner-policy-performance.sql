-- Same owner checks, evaluated once per statement rather than once per row.
alter policy "Users can manage their own transactions" on public.transactions
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy "Users can manage their own settings" on public.user_settings
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
