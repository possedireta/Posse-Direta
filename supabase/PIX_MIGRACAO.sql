-- Execute este arquivo se você já rodou setup.sql anteriormente.
alter table public.purchases add column if not exists provider_order_id text;
alter table public.purchases add column if not exists payment_method text;
create index if not exists purchases_provider_order_id_idx on public.purchases(provider_order_id);
