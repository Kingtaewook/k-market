-- 보안 점검(Security Advisor) 경고 정리
-- 1) 가입·정보보호용 자동 함수는 밖에서 직접 부를 일이 없으니 막기 (자동 실행은 그대로 됨)
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.protect_profile() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
-- 2) 관리자 확인 함수는 로그인한 회원 권한 검사에 꼭 필요 → 로그인 안 한 사람만 막기
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
