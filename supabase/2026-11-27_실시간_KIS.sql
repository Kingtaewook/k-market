-- 한국투자증권 실시간 시세용: 접근 토큰을 하루 동안 재사용하려고 저장 (Edge Function 만 읽고 씀)
create table if not exists public.kis_token (
  id int primary key,
  token text not null,
  expires_at timestamptz not null
);
alter table public.kis_token enable row level security;
-- 정책을 하나도 만들지 않음 → 회원·비회원 모두 접근 불가, 서버(service role)만 사용
