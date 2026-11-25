-- 카카오 가입 · 가짜 가입 거르기 · 기기 제한 · 긍정 뉴스 권한 · 알람 (여러 번 실행해도 안전)

-- 1) 회원 정보 칸 추가: 긍정 뉴스 권한, 가입 방식
alter table public.profiles add column if not exists can_positive boolean not null default false;
alter table public.profiles add column if not exists provider text;

-- 2) 같은 전화번호로 두 번 가입 막기 (빈 번호는 제외)
create unique index if not exists profiles_phone_unique on public.profiles (regexp_replace(phone, '\D', '', 'g'))
  where phone <> '';

-- 3) 본인 정보는 본인이 채울 수 있게 (카카오 가입 후 추가 정보 입력용)
--    단, 승인 상태·관리자·긍정 뉴스 권한은 관리자만 바꿀 수 있음
drop policy if exists "self update" on public.profiles;
create policy "self update" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.status := old.status; new.is_admin := old.is_admin; new.can_positive := old.can_positive;
    new.approved_at := old.approved_at; new.email := old.email; new.created_at := old.created_at;
  end if;
  return new;
end $$;
drop trigger if exists protect_profile on public.profiles;
create trigger protect_profile before update on public.profiles for each row execute function public.protect_profile();

-- 4) 가입 시 회원 정보 자동 생성 (카카오면 닉네임을 이름 칸에 임시로)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, name, birth, gender, phone, email, agreed_at, provider)
  values (new.id, coalesce(m->>'name', m->>'full_name', m->>'user_name', ''),
          case when (m->>'birth') ~ '^\d{4}-\d{2}-\d{2}$' then (m->>'birth')::date end,
          m->>'gender', coalesce(m->>'phone', ''), new.email,
          case when m ? 'agreed' then now() end,
          coalesce(new.raw_app_meta_data->>'provider', 'email'))
  on conflict (id) do nothing;
  return new;
end $$;

-- 5) 기기 제한: 휴대폰 1대 + PC 1대 (새로 로그인한 기기가 이김)
create table if not exists public.user_devices (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('mobile', 'pc')),
  device_id text not null,
  label text,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);
alter table public.user_devices enable row level security;
drop policy if exists "own devices" on public.user_devices;
create policy "own devices" on public.user_devices for all to authenticated
  using (user_id = (select auth.uid()) or public.is_admin()) with check (user_id = (select auth.uid()));

-- 6) 알람: 관리자·자동 알람이 회원별로 쌓이고, 회원은 읽고 지우기만
create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'notice',   -- notice 공지 / approval 승인 / move 급등락 / high 신고가 / news 뉴스
  title text not null,
  body text,
  link text,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists "read own notif" on public.notifications;
create policy "read own notif" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
drop policy if exists "delete own notif" on public.notifications;
create policy "delete own notif" on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
drop policy if exists "admin send notif" on public.notifications;
create policy "admin send notif" on public.notifications for insert to authenticated
  with check (public.is_admin());

-- 7) 7일 지나도 승인 안 된 가입자 자동 삭제 (매일 새벽 4시 KST)
create extension if not exists pg_cron;
select cron.schedule('kmarket-cleanup-pending', '0 19 * * *', $$
  delete from auth.users u using public.profiles p
  where p.id = u.id and p.status = 'pending' and not p.is_admin and p.created_at < now() - interval '7 days'
$$);
