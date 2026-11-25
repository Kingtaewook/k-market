// Supabase 연결 정보 — 공개용(publishable) 키라 브라우저에 노출돼도 됩니다. 개인 데이터는 RLS 정책으로 본인만 접근할 수 있어요.
window.KM_CONFIG = {
  supabase: {
    url: "https://unqahkpxfasufcvpbeai.supabase.co",
    anonKey: "sb_publishable_36Ho4MZMd5KnfkXji6af9g_8tF6uLKW",
  },
  // 회원 승인제: 홈·시장은 누구나, 테마·섹터·뉴스·내 투자와 종목의 점수·재무지표는 관리자가 승인한 회원만
  approval: true,
};
