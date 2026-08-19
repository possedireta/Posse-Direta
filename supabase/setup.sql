create extension if not exists pgcrypto;
create table if not exists public.profiles(id uuid primary key references auth.users(id) on delete cascade,email text,full_name text,role text not null default 'student' check(role in('student','admin')),created_at timestamptz not null default now());
create table if not exists public.contests(id uuid primary key default gen_random_uuid(),title text not null,institution text,exam_board text,description text,exam_date date,price_cents integer not null default 0 check(price_cents>=0),position integer not null default 0,is_published boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table if not exists public.contest_disciplines(id uuid primary key default gen_random_uuid(),contest_id uuid not null references public.contests(id) on delete cascade,name text not null,description text,icon text,position integer not null default 0,is_active boolean not null default true);
create table if not exists public.subjects(id uuid primary key default gen_random_uuid(),contest_discipline_id uuid not null references public.contest_disciplines(id) on delete cascade,name text not null,description text,position integer not null default 0,is_active boolean not null default true);
create table if not exists public.materials(id uuid primary key default gen_random_uuid(),subject_id uuid not null references public.subjects(id) on delete cascade,type text not null check(type in('pdf','video','quiz')),title text not null,description text,storage_path text,external_url text,position integer not null default 0,is_published boolean not null default true,created_at timestamptz not null default now());
create table if not exists public.contest_access(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,contest_id uuid not null references public.contests(id) on delete cascade,status text not null default 'active' check(status in('active','revoked')),source text not null check(source in('paid','free')),granted_by uuid references auth.users(id),expires_at timestamptz,created_at timestamptz not null default now(),unique(user_id,contest_id));
create table if not exists public.purchases(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,contest_id uuid not null references public.contests(id) on delete restrict,amount_cents integer not null,status text not null default 'pending' check(status in('pending','approved','rejected','cancelled','refunded')),provider text not null default 'mercadopago',provider_preference_id text,provider_payment_id text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table if not exists public.user_progress(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,material_id uuid not null references public.materials(id) on delete cascade,completed boolean not null default false,last_opened_at timestamptz,updated_at timestamptz not null default now(),unique(user_id,material_id));
create table if not exists public.favorites(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,material_id uuid not null references public.materials(id) on delete cascade,created_at timestamptz not null default now(),unique(user_id,material_id));
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$ begin insert into public.profiles(id,email,full_name) values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name','')) on conflict(id) do nothing;return new;end $$;
drop trigger if exists on_auth_user_created on auth.users;create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin'); $$;
create or replace function public.has_contest_access(cid uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.contest_access where user_id=auth.uid() and contest_id=cid and status='active' and (expires_at is null or expires_at>now())); $$;
drop policy if exists "profiles read" on public.profiles;
drop policy if exists "profiles update" on public.profiles;
drop policy if exists "catalog contests" on public.contests;
drop policy if exists "admin contests" on public.contests;
drop policy if exists "disciplines access" on public.contest_disciplines;
drop policy if exists "admin disciplines" on public.contest_disciplines;
drop policy if exists "subjects access" on public.subjects;
drop policy if exists "admin subjects" on public.subjects;
drop policy if exists "materials access" on public.materials;
drop policy if exists "admin materials" on public.materials;
drop policy if exists "own access read" on public.contest_access;
drop policy if exists "admin access write" on public.contest_access;
drop policy if exists "own purchases read" on public.purchases;
drop policy if exists "own progress read" on public.user_progress;
drop policy if exists "own progress insert" on public.user_progress;
drop policy if exists "own progress update" on public.user_progress;
drop policy if exists "own favorites read" on public.favorites;
drop policy if exists "own favorites insert" on public.favorites;
drop policy if exists "own favorites delete" on public.favorites;
drop policy if exists "storage protected read" on storage.objects;
drop policy if exists "storage admin insert" on storage.objects;
drop policy if exists "storage admin update" on storage.objects;
drop policy if exists "storage admin delete" on storage.objects;
alter table public.profiles enable row level security;alter table public.contests enable row level security;alter table public.contest_disciplines enable row level security;alter table public.subjects enable row level security;alter table public.materials enable row level security;alter table public.contest_access enable row level security;alter table public.purchases enable row level security;alter table public.user_progress enable row level security;alter table public.favorites enable row level security;
create policy "profiles read" on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin());create policy "profiles update" on public.profiles for update to authenticated using(id=auth.uid() or public.is_admin()) with check(id=auth.uid() or public.is_admin());
create policy "catalog contests" on public.contests for select to authenticated using(is_published or public.is_admin());create policy "admin contests" on public.contests for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "disciplines access" on public.contest_disciplines for select to authenticated using(public.is_admin() or (is_active and public.has_contest_access(contest_id)));create policy "admin disciplines" on public.contest_disciplines for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "subjects access" on public.subjects for select to authenticated using(public.is_admin() or (is_active and exists(select 1 from public.contest_disciplines d where d.id=contest_discipline_id and public.has_contest_access(d.contest_id))));create policy "admin subjects" on public.subjects for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "materials access" on public.materials for select to authenticated using(public.is_admin() or (is_published and exists(select 1 from public.subjects s join public.contest_disciplines d on d.id=s.contest_discipline_id where s.id=subject_id and public.has_contest_access(d.contest_id))));create policy "admin materials" on public.materials for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "own access read" on public.contest_access for select to authenticated using(user_id=auth.uid() or public.is_admin());create policy "admin access write" on public.contest_access for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "own purchases read" on public.purchases for select to authenticated using(user_id=auth.uid() or public.is_admin());
create policy "own progress read" on public.user_progress for select to authenticated using(user_id=auth.uid());create policy "own progress insert" on public.user_progress for insert to authenticated with check(user_id=auth.uid());create policy "own progress update" on public.user_progress for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "own favorites read" on public.favorites for select to authenticated using(user_id=auth.uid());create policy "own favorites insert" on public.favorites for insert to authenticated with check(user_id=auth.uid());create policy "own favorites delete" on public.favorites for delete to authenticated using(user_id=auth.uid());
insert into storage.buckets(id,name,public) values('materials','materials',false) on conflict(id) do update set public=false;
create policy "storage protected read" on storage.objects for select to authenticated using(bucket_id='materials' and (public.is_admin() or exists(select 1 from public.materials m join public.subjects s on s.id=m.subject_id join public.contest_disciplines d on d.id=s.contest_discipline_id where m.storage_path=storage.objects.name and public.has_contest_access(d.contest_id))));
create policy "storage admin insert" on storage.objects for insert to authenticated with check(bucket_id='materials' and public.is_admin());create policy "storage admin update" on storage.objects for update to authenticated using(bucket_id='materials' and public.is_admin()) with check(bucket_id='materials' and public.is_admin());create policy "storage admin delete" on storage.objects for delete to authenticated using(bucket_id='materials' and public.is_admin());
-- depois do seu cadastro: update public.profiles set role='admin' where email='SEU_EMAIL';
update public.profiles set role='admin' where email='possedireta@gmail.com';

-- PIX DIRETO (Orders API)
alter table public.purchases add column if not exists provider_order_id text;
alter table public.purchases add column if not exists payment_method text;
create index if not exists purchases_provider_order_id_idx on public.purchases(provider_order_id);


-- QUESTÕES GRATUITAS DO DIA
create table if not exists public.daily_questions(
  id uuid primary key default gen_random_uuid(),
  publish_date date not null default current_date,
  position integer not null default 1 check(position between 1 and 10),
  question_text text not null,
  options jsonb not null default '[]'::jsonb,
  correct_index integer not null check(correct_index between 0 and 4),
  explanation text,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(publish_date,position),
  check(jsonb_typeof(options)='array'),
  check(jsonb_array_length(options) between 2 and 5)
);
alter table public.daily_questions enable row level security;
drop policy if exists "daily questions public read" on public.daily_questions;
drop policy if exists "daily questions admin all" on public.daily_questions;
create policy "daily questions public read" on public.daily_questions for select to anon, authenticated using(is_published=true or public.is_admin());
create policy "daily questions admin all" on public.daily_questions for all to authenticated using(public.is_admin()) with check(public.is_admin());

-- ÁREA DE SIMULADOS
alter table public.materials add column if not exists is_simulator boolean not null default false;
