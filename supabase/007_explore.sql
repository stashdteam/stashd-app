-- Stashd: save public boards (with a save count) for Explore.
-- Run once in Supabase: SQL Editor → + New query → paste → Run. Safe to run again.
alter table public.boards add column if not exists save_count integer not null default 0;
create index if not exists boards_popular_idx on public.boards (visibility, save_count desc, created_at desc);

create table if not exists public.board_saves (
  user_id uuid not null references public.profiles (id) on delete cascade,
  board_id uuid not null references public.boards (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, board_id)
);
create index if not exists board_saves_board_idx on public.board_saves (board_id);
alter table public.board_saves enable row level security;
grant select, insert, delete on public.board_saves to authenticated;

-- You see and change only your own saves. You can save public boards that aren't yours.
drop policy if exists "saves: read own" on public.board_saves;
create policy "saves: read own" on public.board_saves for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "saves: add own" on public.board_saves;
create policy "saves: add own" on public.board_saves for insert to authenticated
  with check (user_id = (select auth.uid()) and public.board_is_public(board_id)
              and not exists (select 1 from public.boards b where b.id = board_id and b.user_id = (select auth.uid())));
drop policy if exists "saves: remove own" on public.board_saves;
create policy "saves: remove own" on public.board_saves for delete to authenticated using (user_id = (select auth.uid()));

-- Keep boards.save_count up to date
create or replace function public.bump_save_count()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then update public.boards set save_count = save_count + 1 where id = new.board_id;
  else update public.boards set save_count = greatest(save_count - 1, 0) where id = old.board_id; end if;
  return null;
end;
$$;
drop trigger if exists board_saves_count on public.board_saves;
create trigger board_saves_count after insert or delete on public.board_saves for each row execute function public.bump_save_count();

-- Fix counts for anything saved before
update public.boards b set save_count = (select count(*) from public.board_saves s where s.board_id = b.id);
