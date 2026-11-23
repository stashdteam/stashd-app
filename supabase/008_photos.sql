-- Stashd: keep all of a product's photos (the first one stays the cover in image_url).
-- Run once in Supabase: SQL Editor → + New query → paste → Run. Safe to run again.
alter table public.items add column if not exists images text[] not null default '{}';

-- Board links (public / shared by link) also return the photos. Notes stay private.
create or replace function public.shared_board(bid uuid, k uuid default null)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'board', json_build_object('id', b.id, 'name', b.name, 'visibility', b.visibility, 'user_id', b.user_id),
    'owner', (select json_build_object('id', p.id, 'username', p.username, 'name', p.name) from public.profiles p where p.id = b.user_id),
    'items', coalesce((select json_agg(i order by i.created_at desc) from (
        select id, user_id, board_id, url, title, brand, image_url, images, price, was_price, currency, size, sold_out, bought, created_at
        from public.items where board_id = b.id) i), '[]'::json))
  from public.boards b
  where b.id = bid and (b.visibility = 'public' or (b.link_token is not null and b.link_token = k));
$$;
