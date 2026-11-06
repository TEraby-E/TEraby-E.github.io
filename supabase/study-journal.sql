begin;

create table if not exists public.study_journals (
  user_id uuid primary key references auth.users (id) on delete cascade,
  revision bigint not null check (revision between 1 and 9007199254740991),
  snapshot jsonb not null check (
    (jsonb_typeof(snapshot -> 'current') = 'object'
      and jsonb_typeof(snapshot -> 'archives') = 'array') is true
  )
);

alter table public.study_journals enable row level security;
revoke all on public.study_journals from public, anon, authenticated;
grant select, insert on public.study_journals to authenticated;
grant update (revision, snapshot) on public.study_journals to authenticated;

drop policy if exists "Own study journal" on public.study_journals;
create policy "Own study journal" on public.study_journals
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'study_journals'
  ) then
    alter publication supabase_realtime add table public.study_journals;
  end if;
end
$$;

commit;
