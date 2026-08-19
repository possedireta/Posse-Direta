-- POSSE DIRETA - QUESTOES GRATUITAS VIA ARQUIVO HTML
-- Execute UMA VEZ no SQL Editor do Supabase.

create table if not exists public.free_quizzes (
 id uuid primary key default gen_random_uuid(),
 publish_date date not null default current_date,
 title text not null,
 description text,
 storage_path text not null,
 is_published boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists free_quizzes_date_idx on public.free_quizzes(publish_date);
alter table public.free_quizzes enable row level security;
drop policy if exists "free quizzes public read" on public.free_quizzes;
drop policy if exists "free quizzes admin all" on public.free_quizzes;
create policy "free quizzes public read" on public.free_quizzes for select to anon, authenticated using(is_published=true or public.is_admin());
create policy "free quizzes admin all" on public.free_quizzes for all to authenticated using(public.is_admin()) with check(public.is_admin());

-- Bucket separado e publico: somente os HTMLs gratuitos ficam aqui.
insert into storage.buckets(id,name,public) values('free-quizzes','free-quizzes',true) on conflict(id) do update set public=true;
drop policy if exists "free quizzes admin insert" on storage.objects;
drop policy if exists "free quizzes admin update" on storage.objects;
drop policy if exists "free quizzes admin delete" on storage.objects;
create policy "free quizzes admin insert" on storage.objects for insert to authenticated with check(bucket_id='free-quizzes' and public.is_admin());
create policy "free quizzes admin update" on storage.objects for update to authenticated using(bucket_id='free-quizzes' and public.is_admin()) with check(bucket_id='free-quizzes' and public.is_admin());
create policy "free quizzes admin delete" on storage.objects for delete to authenticated using(bucket_id='free-quizzes' and public.is_admin());
