-- ============================================================
-- POSSE DIRETA — QUESTÕES GRATUITAS DO DIA
-- Simulados reutilizam os materiais existentes do tipo "quiz".
-- Execute este arquivo UMA VEZ no SQL Editor do Supabase.
-- ============================================================

-- Marca quais materiais HTML são simulados (sem misturar com listas comuns).
alter table public.materials add column if not exists is_simulator boolean not null default false;

create table if not exists public.daily_questions (
  id uuid primary key default gen_random_uuid(),
  publish_date date not null default current_date,
  position integer not null default 1 check (position between 1 and 10),
  question_text text not null,
  options jsonb not null default '[]'::jsonb,
  correct_index integer not null check (correct_index between 0 and 4),
  explanation text,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (publish_date, position),
  check (jsonb_typeof(options) = 'array'),
  check (jsonb_array_length(options) between 2 and 5)
);

create index if not exists daily_questions_publish_date_idx
  on public.daily_questions (publish_date, position);

alter table public.daily_questions enable row level security;

drop policy if exists "daily questions public read" on public.daily_questions;
drop policy if exists "daily questions admin all" on public.daily_questions;

-- Qualquer visitante (até sem login) pode ver somente questões publicadas.
create policy "daily questions public read"
on public.daily_questions
for select
to anon, authenticated
using (is_published = true or public.is_admin());

-- Somente administrador cadastra, edita ou exclui.
create policy "daily questions admin all"
on public.daily_questions
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());
