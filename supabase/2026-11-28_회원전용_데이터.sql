-- 회원 전용 데이터: 「정리」 화면의 하루 기록(journal)·돌아보기(review)를 공개 저장소 대신 여기에 저장
-- 읽기: 승인된 회원만 / 쓰기: GitHub 작업(서비스 키)만
create table if not exists public.member_data (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.member_data enable row level security;
drop policy if exists "member_data read approved" on public.member_data;
create policy "member_data read approved" on public.member_data for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'approved'));
revoke all on public.member_data from anon;
