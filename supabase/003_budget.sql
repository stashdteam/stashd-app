-- Stashd: choose which boards and items count toward "Left to spend".
-- Run once in Supabase: SQL Editor → New query → paste → Run. Safe to run again.
alter table public.boards add column if not exists in_budget boolean not null default true;
alter table public.items add column if not exists in_budget boolean not null default true;
