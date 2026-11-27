// 한국투자증권(KIS) 실시간 시세 중계 — 승인된 회원만, 한 번에 최대 30종목
// 비밀 값(Supabase → Edge Functions → Secrets): KIS_APP_KEY, KIS_APP_SECRET
// SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY 는 Supabase 가 자동으로 넣어 줌
import { createClient } from "jsr:@supabase/supabase-js@2";

const KIS = "https://openapi.koreainvestment.com:9443";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "content-type": "application/json" } });
const num = (v: unknown) => { const n = parseFloat(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : null; };

let memToken: { token: string; exp: number } | null = null;
let memQuotes: { key: string; at: number; body: unknown } | null = null; // 같은 요청은 5초간 재사용

async function kisToken(admin: ReturnType<typeof createClient>) {
  if (memToken && Date.now() < memToken.exp) return memToken.token;
  const { data } = await admin.from("kis_token").select("token, expires_at").eq("id", 1).maybeSingle();
  if (data && new Date(data.expires_at).getTime() - 600_000 > Date.now()) {
    memToken = { token: data.token, exp: new Date(data.expires_at).getTime() - 600_000 };
    return data.token as string;
  }
  const r = await fetch(`${KIS}/oauth2/tokenP`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", appkey: Deno.env.get("KIS_APP_KEY"), appsecret: Deno.env.get("KIS_APP_SECRET") }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("KIS 토큰 발급 실패: " + (j.error_description || j.msg1 || r.status));
  const exp = Date.now() + (Number(j.expires_in) || 86400) * 1000;
  await admin.from("kis_token").upsert({ id: 1, token: j.access_token, expires_at: new Date(exp).toISOString() });
  memToken = { token: j.access_token, exp: exp - 600_000 };
  return j.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    // 1) 로그인 + 승인 회원인지 확인 (KIS 호출 한도를 아무나 쓰지 못하게)
    const auth = req.headers.get("Authorization") || "";
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "로그인이 필요해요" }, 401);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: p } = await admin.from("profiles").select("status").eq("id", u.user.id).maybeSingle();
    if (p?.status !== "approved") return json({ error: "승인된 회원만 쓸 수 있어요" }, 403);

    // 2) 요청 정리
    const body = await req.json().catch(() => ({}));
    const market = body.market === "NX" ? "NX" : "J";
    const codes = [...new Set((body.codes || []).map(String).filter((c: string) => /^\d{6}$/.test(c)))].slice(0, 30) as string[];
    if (!codes.length) return json({ quotes: {} });
    const key = market + codes.sort().join(",") + "|" + String(body.ccnl || "");
    if (memQuotes && memQuotes.key === key && Date.now() - memQuotes.at < 5000) return json(memQuotes.body);

    // 3) KIS 멀티종목 시세 (FHKST11300006, 최대 30종목)
    const token = await kisToken(admin);
    const q = new URLSearchParams();
    codes.forEach((c, i) => { q.set(`FID_COND_MRKT_DIV_CODE_${i + 1}`, market); q.set(`FID_INPUT_ISCD_${i + 1}`, c); });
    const r = await fetch(`${KIS}/uapi/domestic-stock/v1/quotations/intstock-multprice?${q}`, {
      headers: { authorization: `Bearer ${token}`, appkey: Deno.env.get("KIS_APP_KEY")!, appsecret: Deno.env.get("KIS_APP_SECRET")!, tr_id: "FHKST11300006", custtype: "P", "content-type": "application/json; charset=utf-8" },
    });
    const j = await r.json();
    if (j.rt_cd !== "0") return json({ error: `${j.msg_cd} ${j.msg1}` }, 502);
    const quotes: Record<string, unknown> = {};
    for (const o of j.output || []) {
      const close = num(o.inter2_prpr);
      if (o.inter_shrn_iscd && close) quotes[o.inter_shrn_iscd] = { close, chg: (num(o.prdy_ctrt) ?? 0) / 100, amount: num(o.acml_tr_pbmn) };
    }
    // 4) (선택) 종목 화면: 최근 체결 30건 중 500만원 이상 큰 체결 (매수/매도는 직전 체결가와 비교한 틱 규칙으로 추정)
    let big: unknown[] | undefined;
    const cc = String(body.ccnl || "");
    if (/^\d{6}$/.test(cc)) {
      try {
        const r2 = await fetch(`${KIS}/uapi/domestic-stock/v1/quotations/inquire-ccnl?${new URLSearchParams({ FID_COND_MRKT_DIV_CODE: market, FID_INPUT_ISCD: cc })}`, {
          headers: { authorization: `Bearer ${token}`, appkey: Deno.env.get("KIS_APP_KEY")!, appsecret: Deno.env.get("KIS_APP_SECRET")!, tr_id: "FHKST01010300", custtype: "P", "content-type": "application/json; charset=utf-8" },
        });
        const j2 = await r2.json();
        const rows = (j2.output || []).slice().reverse(); // 오래된 것 → 최신
        let prevPx = 0, side = "?";
        big = [];
        for (const o of rows) {
          const px = num(o.stck_prpr) || 0, vol = num(o.cntg_vol) || 0, t = String(o.stck_cntg_hour || "");
          if (prevPx) side = px > prevPx ? "buy" : px < prevPx ? "sell" : side;
          prevPx = px;
          if (px * vol >= 5_000_000) big.push({ t: `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`, px, vol, amt: px * vol, side });
        }
        big = big.slice(-15).reverse(); // 최신 15건
      } catch (_) { big = undefined; }
    }
    const out = { at: new Date().toISOString(), market, quotes, ...(cc ? { code: cc, big } : {}) };
    memQuotes = { key, at: Date.now(), body: out };
    return json(out);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
