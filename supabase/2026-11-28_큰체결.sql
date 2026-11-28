-- 큰 체결(5,000만원 이상) 하루 집계 — 거래대금 상위 40종목, 승인 회원만 읽기
create table if not exists public.big_trades_day (
  code text not null,
  d date not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (code, d)
);
alter table public.big_trades_day enable row level security;
drop policy if exists "big_trades read approved" on public.big_trades_day;
create policy "big_trades read approved" on public.big_trades_day for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'approved'));
-- 30일 지난 기록은 매일 새벽 정리
select cron.unschedule(jobid) from cron.job where jobname = 'big-trades-cleanup';
select cron.schedule('big-trades-cleanup', '10 18 * * *', $$ delete from public.big_trades_day where d < current_date - 30 $$);
