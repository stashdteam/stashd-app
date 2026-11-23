-- Stashd: price checks (Refresh button + an hourly scheduled job) and in-app notifications.
-- Run once in Supabase: SQL Editor → + New query → paste all → Run. Safe to run again.
-- Before running: redeploy the read-link function with the new code and "Verify JWT" turned OFF.

-- When each item was last checked, and its previous price
alter table public.items add column if not exists last_checked_at timestamptz;
alter table public.items add column if not exists check_status text;          -- ok / blocked / no_product / ...
alter table public.items add column if not exists prev_price numeric(12,2);
alter table public.items add column if not exists price_changed_at timestamptz;

-- Price history (one row per check)
create table if not exists public.price_history (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.items (id) on delete cascade,
  price numeric(12,2),
  currency text,
  sold_out boolean,
  checked_at timestamptz not null default now()
);
create index if not exists price_history_item_idx on public.price_history (item_id, checked_at desc);
alter table public.price_history enable row level security;
grant select on public.price_history to authenticated;
drop policy if exists "history: items I can see" on public.price_history;
create policy "history: items I can see" on public.price_history for select to authenticated
  using (exists (select 1 from public.items i where i.id = item_id));

-- In-app notifications (price dropped / went up / back in stock / sold out)
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid references public.items (id) on delete cascade,
  kind text not null check (kind in ('price_drop', 'price_up', 'back_in_stock', 'sold_out')),
  old_price numeric(12,2),
  new_price numeric(12,2),
  currency text,
  title text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
grant select, update, delete on public.notifications to authenticated;
drop policy if exists "notifications: read own" on public.notifications;
create policy "notifications: read own" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "notifications: mark own read" on public.notifications;
create policy "notifications: mark own read" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "notifications: delete own" on public.notifications;
create policy "notifications: delete own" on public.notifications for delete to authenticated using (user_id = (select auth.uid()));

-- The function's own server key needs these (newer projects don't grant them automatically)
grant select, insert, update, delete on public.items, public.price_history, public.notifications to service_role;

-- A random secret so only the scheduled job can start a batch check. Nobody can read it through the app.
create table if not exists public.app_secrets (name text primary key, value text not null);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;
grant select on public.app_secrets to service_role;
insert into public.app_secrets (name, value)
values ('cron', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;

-- Every hour at :17, check up to 40 items that haven't been checked for about 20 hours (so each item ≈ once a day).
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname = 'stashd-check-prices';
select cron.schedule('stashd-check-prices', '17 * * * *', $job$
  select net.http_post(
    url := 'https://fmwwzixstqlytalqwuda.supabase.co/functions/v1/read-link',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from public.app_secrets where name = 'cron')),
    body := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 120000
  );
$job$);
