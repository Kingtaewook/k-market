-- K-Market Intelligence: 사용자 데이터 (Supabase SQL Editor 에서 한 번 실행)

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trade_date date not null default ((now() at time zone 'Asia/Seoul')::date),
  code text not null check (code ~ '^[0-9A-Z]{6}$'),
  name text not null,
  side text not null check (side in ('buy', 'sell')),
  qty numeric not null check (qty > 0),
  price numeric not null check (price >= 0),
  fee numeric not null default 0 check (fee >= 0),
  reason text,
  memo text,
  created_at timestamptz not null default now()
);
create index if not exists trades_user_date on public.trades (user_id, trade_date desc);

create table if not exists public.watchlist (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  code text not null,
  name text not null,
  price numeric,            -- 등록할 때의 현재가 (등록 후 수익률 계산)
  created_at timestamptz not null default now(),
  primary key (user_id, code)
);

create table if not exists public.my_themes (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('theme', 'industry')),
  no text not null,
  name text not null,
  base jsonb not null default '{}'::jsonb,  -- 등록 시점 소속 종목 종가
  created_at timestamptz not null default now(),
  primary key (user_id, kind, no)
);

create table if not exists public.journal (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  total_value numeric,
  cost_basis numeric,
  invested numeric,
  realized numeric,
  day_pnl numeric,
  day_ret numeric,
  cum_ret numeric,
  kospi_ret numeric,
  positions jsonb,
  events jsonb,
  note text,
  updated_at timestamptz default now(),
  primary key (user_id, date)
);

alter table public.trades enable row level security;
alter table public.watchlist enable row level security;
alter table public.journal enable row level security;
alter table public.my_themes enable row level security;

drop policy if exists "own themes" on public.my_themes;
create policy "own themes" on public.my_themes for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- 본인 데이터만 읽고 쓸 수 있음
drop policy if exists "own trades" on public.trades;
create policy "own trades" on public.trades for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "own watchlist" on public.watchlist;
create policy "own watchlist" on public.watchlist for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- 일지는 자동 생성(서비스 키)만 쓰고, 사용자는 읽기 + 메모 수정만
drop policy if exists "read own journal" on public.journal;
create policy "read own journal" on public.journal for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "note own journal" on public.journal;
create policy "note own journal" on public.journal for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke update on public.journal from authenticated;
grant update (note) on public.journal to authenticated;
