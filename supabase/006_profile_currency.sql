-- Stashd: keep each person's currency on their profile, so price checks convert to it.
-- Run once in Supabase: SQL Editor → + New query → paste → Run. Safe to run again.
alter table public.profiles add column if not exists currency text;
alter table public.profiles drop constraint if exists profiles_currency_check;
alter table public.profiles add constraint profiles_currency_check check (currency is null or currency ~ '^[A-Z]{3}$');

-- Copy the currency people already picked (saved with their login details)
update public.profiles p set currency = upper(u.raw_user_meta_data ->> 'currency')
from auth.users u
where u.id = p.id and p.currency is null and upper(u.raw_user_meta_data ->> 'currency') ~ '^[A-Z]{3}$';

-- New accounts: take the currency chosen at sign-up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  u text := lower(new.raw_user_meta_data ->> 'username');
  c text := upper(new.raw_user_meta_data ->> 'currency');
begin
  if u is null or not public.username_available(u) then u := null; end if;
  if c is null or c !~ '^[A-Z]{3}$' then c := null; end if;
  insert into public.profiles (id, username, name, currency)
  values (new.id, u, left(coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name', ''), 50), c)
  on conflict (id) do nothing;
  return new;
exception when others then
  return new;
end;
$$;

grant select on public.profiles to service_role;
