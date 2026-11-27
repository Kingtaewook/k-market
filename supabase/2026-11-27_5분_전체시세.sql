-- 5분마다 전 종목 시세 저장 (Edge Function 'kis-market' 을 예약 작업이 부름)
-- 1) 시세 저장 표: 누구나 읽기만 가능 (홈·시장은 공개 화면이라)
create table if not exists public.live_cache (
  id int primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.live_cache enable row level security;
drop policy if exists "live_cache read" on public.live_cache;
create policy "live_cache read" on public.live_cache for select using (true);

-- 2) 예약 작업 확인용 열쇠: 무작위로 만들어 DB 안에만 보관 (정책 없음 → 바깥에서 못 읽음)
create table if not exists public.app_secret (id text primary key, val text not null);
alter table public.app_secret enable row level security;
insert into public.app_secret (id, val)
values ('cron', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (id) do nothing;

-- 3) 5분마다 부르기 (평일·장 시간 판단은 함수가 함)
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'kis-market';
select cron.schedule('kis-market', '*/5 * * * *', $job$
  select net.http_post(
    url := 'https://unqahkpxfasufcvpbeai.supabase.co/functions/v1/kis-market',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'apikey', 'sb_publishable_36Ho4MZMd5KnfkXji6af9g_8tF6uLKW',
      'Authorization', 'Bearer sb_publishable_36Ho4MZMd5KnfkXji6af9g_8tF6uLKW',
      'x-cron-key', (select val from public.app_secret where id = 'cron')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$job$);
