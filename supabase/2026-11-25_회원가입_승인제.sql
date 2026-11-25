-- 회원가입 + 관리자 승인제 (Supabase SQL Editor 에서 한 번 실행, 여러 번 실행해도 안전)

-- 1) 회원 정보
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  birth date,
  gender text,
  phone text not null default '',
  email text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  is_admin boolean not null default false,
  agreed_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- 2) 관리자 여부 (정책 안에서 쓰는 함수)
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- 3) 권한: 본인 정보는 읽기만, 관리자는 전체 읽기·승인·삭제 (본인이 스스로 승인할 수 없음)
drop policy if exists "read own or admin" on public.profiles;
create policy "read own or admin" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());
drop policy if exists "admin update" on public.profiles;
create policy "admin update" on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin delete" on public.profiles;
create policy "admin delete" on public.profiles for delete to authenticated
  using (public.is_admin());

-- 4) 가입하면 입력한 정보로 회원 정보 자동 생성 (승인 대기)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, name, birth, gender, phone, email, agreed_at)
  values (new.id, coalesce(m->>'name', ''),
          case when (m->>'birth') ~ '^\d{4}-\d{2}-\d{2}$' then (m->>'birth')::date end,
          m->>'gender', coalesce(m->>'phone', ''), new.email,
          case when m ? 'agreed' then now() end)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5) 이미 가입된 사람들도 '승인 대기'로 등록
insert into public.profiles (id, email) select id, email from auth.users on conflict (id) do nothing;

-- 6) 관리자(태욱님) 계정: 승인 + 관리자
update public.profiles set status = 'approved', is_admin = true, approved_at = now(),
  name = case when name = '' then '관리자' else name end
where email = 'dnrdkdmrdk12@gmail.com';
