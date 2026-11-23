-- Stashd full database setup (for a new project). Paste all of this into Supabase: SQL Editor → New query → Run.
-- Safe to run more than once. Existing projects only need the newest numbered file (e.g. 002_social.sql).

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

alter table public.boards enable row level security;
alter table public.items enable row level security;
-- Table policies are in the social section below.

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

-- ======================= Social: usernames, followers, shared lists =======================
-- ---------- Profiles (public name + username) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique check (username ~ '^[a-z0-9_.]{3,20}$'),
  name text check (char_length(name) <= 50),
  created_at timestamptz not null default now()
);

create or replace function public.is_reserved_username(u text)
returns boolean language sql immutable set search_path = '' as $$
  select u = any (array['admin','administrator','stashd','support','help','root','api','www','settings',
                        'login','signin','signup','privacy','terms','about','team','official','null','undefined']);
$$;

-- Is a username free? (callable before signing up)
create or replace function public.username_available(u text)
returns boolean language sql stable security definer set search_path = '' as $$
  select u ~ '^[a-z0-9_.]{3,20}$'
     and not public.is_reserved_username(u)
     and not exists (select 1 from public.profiles p where p.username = u);
$$;
revoke execute on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- Create a profile for every new account. Never blocks sign-up: a missing or taken
-- username is left empty and the app asks for one after sign-in.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare u text := lower(new.raw_user_meta_data ->> 'username');
begin
  if u is null or not public.username_available(u) then u := null; end if;
  insert into public.profiles (id, username, name)
  values (new.id, u, left(coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name', ''), 50))
  on conflict (id) do nothing;
  return new;
exception when others then
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Profiles for accounts that already exist
insert into public.profiles (id, name)
select id, left(coalesce(raw_user_meta_data ->> 'name', raw_user_meta_data ->> 'full_name', ''), 50) from auth.users
on conflict (id) do nothing;

-- ---------- Follows ----------
create table if not exists public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);
create index if not exists follows_following_idx on public.follows (following_id);

-- ---------- Board sharing ----------
alter table public.boards add column if not exists visibility text not null default 'private';
alter table public.boards drop constraint if exists boards_visibility_check;
alter table public.boards add constraint boards_visibility_check check (visibility in ('private', 'public'));
alter table public.boards add column if not exists link_token uuid;  -- set = "anyone with the link can view" (private boards)

create table if not exists public.board_members (
  board_id uuid not null references public.boards (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('viewer', 'editor')),   -- editor = "can add"
  created_at timestamptz not null default now(),
  primary key (board_id, user_id)
);
create index if not exists board_members_user_idx on public.board_members (user_id);

-- Helpers (security definer so policies don't loop into each other)
create or replace function public.board_role(bid uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.boards b where b.id = bid and b.user_id = (select auth.uid())) then 'owner'
    else (select m.role from public.board_members m where m.board_id = bid and m.user_id = (select auth.uid()))
  end;
$$;
create or replace function public.board_is_public(bid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select b.visibility = 'public' from public.boards b where b.id = bid), false);
$$;
revoke execute on function public.board_role(uuid) from public;
revoke execute on function public.board_is_public(uuid) from public;
grant execute on function public.board_role(uuid) to authenticated;
grant execute on function public.board_is_public(uuid) to anon, authenticated;

-- A board opened from a share link (public, or private with link sharing on). Notes are left out.
create or replace function public.shared_board(bid uuid, k uuid default null)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'board', json_build_object('id', b.id, 'name', b.name, 'visibility', b.visibility, 'user_id', b.user_id),
    'owner', (select json_build_object('id', p.id, 'username', p.username, 'name', p.name) from public.profiles p where p.id = b.user_id),
    'items', coalesce((select json_agg(i order by i.created_at desc) from (
        select id, user_id, board_id, url, title, brand, image_url, price, was_price, currency, size, sold_out, bought, created_at
        from public.items where board_id = b.id) i), '[]'::json))
  from public.boards b
  where b.id = bid and (b.visibility = 'public' or (b.link_token is not null and b.link_token = k));
$$;
revoke execute on function public.shared_board(uuid, uuid) from public;
grant execute on function public.shared_board(uuid, uuid) to anon, authenticated;

-- ---------- Permissions ----------
grant select on public.profiles, public.follows, public.boards, public.items to anon;
grant select, insert, update, delete on public.profiles, public.follows, public.board_members to authenticated;

alter table public.profiles enable row level security;
alter table public.follows enable row level security;
alter table public.board_members enable row level security;

-- Profiles: anyone can see name + username; you edit only your own.
drop policy if exists "profiles: read" on public.profiles;
create policy "profiles: read" on public.profiles for select to anon, authenticated using (true);
drop policy if exists "profiles: insert own" on public.profiles;
create policy "profiles: insert own" on public.profiles for insert to authenticated
  with check (id = (select auth.uid()) and (username is null or not public.is_reserved_username(username)));
drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and (username is null or not public.is_reserved_username(username)));

-- Follows: public; you can only follow/unfollow as yourself.
drop policy if exists "follows: read" on public.follows;
create policy "follows: read" on public.follows for select to anon, authenticated using (true);
drop policy if exists "follows: add own" on public.follows;
create policy "follows: add own" on public.follows for insert to authenticated with check (follower_id = (select auth.uid()));
drop policy if exists "follows: remove own" on public.follows;
create policy "follows: remove own" on public.follows for delete to authenticated using (follower_id = (select auth.uid()));

-- Boards: owner does everything; members and the public can read.
drop policy if exists "boards: own rows" on public.boards;
drop policy if exists "boards: read" on public.boards;
create policy "boards: read" on public.boards for select to authenticated
  using (user_id = (select auth.uid()) or visibility = 'public' or public.board_role(id) is not null);
drop policy if exists "boards: read public" on public.boards;
create policy "boards: read public" on public.boards for select to anon using (visibility = 'public');
drop policy if exists "boards: insert own" on public.boards;
create policy "boards: insert own" on public.boards for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "boards: update own" on public.boards;
create policy "boards: update own" on public.boards for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "boards: delete own" on public.boards;
create policy "boards: delete own" on public.boards for delete to authenticated using (user_id = (select auth.uid()));

-- Items: yours, items in boards you can see, items in public boards.
drop policy if exists "items: own rows" on public.items;
drop policy if exists "items: read" on public.items;
create policy "items: read" on public.items for select to authenticated
  using (user_id = (select auth.uid()) or public.board_role(board_id) is not null or public.board_is_public(board_id));
drop policy if exists "items: read public" on public.items;
create policy "items: read public" on public.items for select to anon using (public.board_is_public(board_id));
drop policy if exists "items: insert" on public.items;
create policy "items: insert" on public.items for insert to authenticated
  with check (user_id = (select auth.uid()) and (board_id is null or public.board_role(board_id) in ('owner', 'editor')));
drop policy if exists "items: update" on public.items;
create policy "items: update" on public.items for update to authenticated
  using (user_id = (select auth.uid()) or public.board_role(board_id) in ('owner', 'editor'))
  with check ((user_id = (select auth.uid()) and board_id is null) or public.board_role(board_id) in ('owner', 'editor'));
drop policy if exists "items: delete" on public.items;
create policy "items: delete" on public.items for delete to authenticated
  using (user_id = (select auth.uid()) or public.board_role(board_id) = 'owner');

-- Board members: members of a board can see each other; only the owner adds/changes/removes;
-- anyone can leave a board shared with them.
drop policy if exists "members: read" on public.board_members;
create policy "members: read" on public.board_members for select to authenticated using (public.board_role(board_id) is not null);
drop policy if exists "members: owner adds" on public.board_members;
create policy "members: owner adds" on public.board_members for insert to authenticated
  with check (public.board_role(board_id) = 'owner' and user_id <> (select auth.uid()));
drop policy if exists "members: owner changes" on public.board_members;
create policy "members: owner changes" on public.board_members for update to authenticated
  using (public.board_role(board_id) = 'owner') with check (public.board_role(board_id) = 'owner');
drop policy if exists "members: owner removes or leave" on public.board_members;
create policy "members: owner removes or leave" on public.board_members for delete to authenticated
  using (public.board_role(board_id) = 'owner' or user_id = (select auth.uid()));

-- ======================= Budget switches =======================
alter table public.boards add column if not exists in_budget boolean not null default true;
alter table public.items add column if not exists in_budget boolean not null default true;

-- ======================= Budgets and converted prices =======================
alter table public.boards add column if not exists budget numeric(12,2);
alter table public.boards drop constraint if exists boards_budget_check;
alter table public.boards add constraint boards_budget_check check (budget is null or budget >= 0);
alter table public.items add column if not exists home_price numeric(12,2);   -- price converted to the owner's currency
alter table public.items add column if not exists home_currency text;
