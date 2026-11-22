-- Stashd database setup. Paste all of this into Supabase: SQL Editor → New query → Run.
-- Safe to run more than once.

-- Boards
create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  created_at timestamptz not null default now()
);
create index if not exists boards_user_idx on public.boards (user_id);

-- Items
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  board_id uuid references public.boards (id) on delete set null,
  url text,
  title text,
  brand text,
  image_url text,
  price numeric(12, 2),
  was_price numeric(12, 2),
  currency text,
  size text,
  sizes text[] not null default '{}',   -- size options read from the store page
  note text,
  sold_out boolean not null default false,
  bought boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists items_user_created_idx on public.items (user_id, created_at desc);
create index if not exists items_board_idx on public.items (board_id);

-- Let signed-in users use the tables (row-level security below still limits them to their own rows).
-- Newer Supabase projects don't grant this automatically for tables made in the SQL editor.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.boards, public.items to authenticated;
revoke all on public.boards, public.items from anon;

-- Row-level security: everyone sees and changes only their own rows.
alter table public.boards enable row level security;
alter table public.items enable row level security;

drop policy if exists "boards: own rows" on public.boards;
create policy "boards: own rows" on public.boards
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "items: own rows" on public.items;
create policy "items: own rows" on public.items
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (board_id is null or exists (
      select 1 from public.boards b where b.id = board_id and b.user_id = (select auth.uid())
    ))
  );

-- Photos people upload themselves. Public bucket: files have unguessable names,
-- and each person can only add, change or delete files in their own folder.
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

drop policy if exists "photos: read own" on storage.objects;
create policy "photos: read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "photos: upload own" on storage.objects;
create policy "photos: upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "photos: update own" on storage.objects;
create policy "photos: update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "photos: delete own" on storage.objects;
create policy "photos: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Lets a signed-in person delete their own account (boards and items go with it).
create or replace function public.delete_my_account()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = (select auth.uid());
$$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
