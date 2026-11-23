-- Stashd: board budgets and prices in your own currency.
-- Run once in Supabase: SQL Editor → + New query → paste → Run. Safe to run again.
alter table public.boards add column if not exists budget numeric(12,2);
alter table public.boards drop constraint if exists boards_budget_check;
alter table public.boards add constraint boards_budget_check check (budget is null or budget >= 0);
alter table public.items add column if not exists home_price numeric(12,2);   -- price converted to the owner's currency
alter table public.items add column if not exists home_currency text;
