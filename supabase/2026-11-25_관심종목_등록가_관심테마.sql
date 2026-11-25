-- 관심 종목 등록가 + 관심 테마 (Supabase SQL Editor 에서 한 번 실행, 여러 번 실행해도 안전)

-- 1) 관심 종목: 등록할 때의 현재가
alter table public.watchlist add column if not exists price numeric;

-- 2) 관심 테마: 섹터(네이버 테마·업종)를 등록, base = 등록 시점 소속 종목 종가 {"005930": 71000, ...}
create table if not exists public.my_themes (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('theme', 'industry')),
  no text not null,
  name text not null,
  base jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, no)
);
alter table public.my_themes enable row level security;
drop policy if exists "own themes" on public.my_themes;
create policy "own themes" on public.my_themes for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
