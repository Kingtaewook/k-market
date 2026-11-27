// 시세 저장 (Supabase 예약 작업이 1분마다 부름)
// - 회원 화면은 이 표를 읽기만 함 → 회원이 늘어도 한국투자증권 호출 수는 그대로
// - 평일 08:00~20:05(한국시간)만 일함. 09:00 전·15:40 뒤는 넥스트레이드(NX) 가격
// - 매분: 코스피·코스닥 지수 + 원·달러 환율 + 오늘 1분 흐름(미니 차트용) → live_cache id=2
// - 5분마다(정각 기준 0·5·10…분): 전 종목 시세 → live_cache id=1
// 비밀 값: KIS_APP_KEY, KIS_APP_SECRET (kis-quote 와 같음). 예약 작업 확인용 열쇠는 DB 의 app_secret 표에만 있음
import { createClient } from "jsr:@supabase/supabase-js@2";

const KIS = "https://openapi.koreainvestment.com:9443";
const STOCKS_URL = "https://kingtaewook.github.io/k-market/data/stocks.json";
const num = (v: unknown) => { const n = parseFloat(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

async function kisToken(admin: ReturnType<typeof createClient>) {
  const { data } = await admin.from("kis_token").select("token, expires_at").eq("id", 1).maybeSingle();
  if (data && new Date(data.expires_at).getTime() - 600_000 > Date.now()) return data.token as string;
  const r = await fetch(`${KIS}/oauth2/tokenP`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", appkey: Deno.env.get("KIS_APP_KEY"), appsecret: Deno.env.get("KIS_APP_SECRET") }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("KIS 토큰 발급 실패: " + (j.error_description || j.msg1 || r.status));
  const exp = Date.now() + (Number(j.expires_in) || 86400) * 1000;
  await admin.from("kis_token").upsert({ id: 1, token: j.access_token, expires_at: new Date(exp).toISOString() });
  return j.access_token as string;
}

async function kisGet(token: string, path: string, trId: string, params: Record<string, string>) {
  const h = { authorization: `Bearer ${token}`, appkey: Deno.env.get("KIS_APP_KEY")!, appsecret: Deno.env.get("KIS_APP_SECRET")!, tr_id: trId, custtype: "P", "content-type": "application/json; charset=utf-8" };
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${KIS}${path}?${new URLSearchParams(params)}`, { headers: h });
    const j = await r.json().catch(() => ({}));
    if (j.rt_cd === "0") return j;
    if (String(j.msg_cd || "").includes("EGW00201")) { await sleep(600 * (i + 1)); continue; } // 초당 한도 → 쉬었다 다시
    throw new Error(`${trId} ${j.msg_cd} ${j.msg1}`);
  }
  throw new Error(`${trId} 호출 한도 초과`);
}

// 원·달러 환율 (네이버 증권 공개 시세, 실패하면 null)
async function usdkrw(): Promise<{ rate: number; chg: number | null } | null> {
  const urls = [
    "https://m.stock.naver.com/front-api/marketIndex/productDetail?category=exchange&reutersCode=FX_USDKRW",
    "https://api.stock.naver.com/marketindex/exchange/FX_USDKRW",
  ];
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0" } });
      if (!r.ok) continue;
      const j = await r.json();
      const o = j?.result || j?.exchangeInfo || j;
      const rate = num(o?.closePrice ?? o?.calcPrice ?? o?.nowValue);
      if (rate) return { rate, chg: (num(o?.fluctuationsRatio) ?? null) !== null ? num(o.fluctuationsRatio)! / 100 : null };
    } catch (e) { console.log("fx", u, String(e)); }
  }
  return null;
}

Deno.serve(async (req) => {
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // 1) 예약 작업에서 온 요청인지 확인
    const { data: sec } = await admin.from("app_secret").select("val").eq("id", "cron").maybeSingle();
    if (!sec?.val || req.headers.get("x-cron-key") !== sec.val) return json({ error: "forbidden" }, 403);

    // 2) 일할 시간인지 (한국시간 평일 08:00~20:05)
    const kst = new Date(Date.now() + 9 * 3600_000);
    const day = kst.getUTCDay(), hm = kst.getUTCHours() * 60 + kst.getUTCMinutes();
    const force = new URL(req.url).searchParams.get("force") === "1";
    if (!force && (day === 0 || day === 6 || hm < 480 || hm > 1205)) return json({ skipped: "장 시간 아님" });
    const nxt = hm < 540 || hm > 940;
    const market = nxt ? "NX" : "J";
    const date = kst.toISOString().slice(0, 10);
    const hhmm = kst.toISOString().slice(11, 16);

    const nowIso = new Date().toISOString();
    const stamp = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 16) + "+09:00";
    const token = await kisToken(admin);

    // 3) [매분] 코스피·코스닥 지수 + 원·달러 환율 → live_cache id=2 (작은 묶음, 화면이 1분마다 읽음)
    const { data: tickRow } = await admin.from("live_cache").select("data").eq("id", 2).maybeSingle();
    const tick = (tickRow?.data || {}) as Record<string, any>;
    const idx: Record<string, { close: number | null; chg: number }> = { ...(tick.idx || {}) };
    for (const [name, iscd] of [["kospi", "0001"], ["kosdaq", "1001"]]) {
      try {
        const j = await kisGet(token, "/uapi/domestic-stock/v1/quotations/inquire-index-price", "FHPUP02100000", { FID_COND_MRKT_DIV_CODE: "U", FID_INPUT_ISCD: iscd });
        const o = j.output || {};
        const close = num(o.bstp_nmix_prpr);
        if (close) idx[name] = { close, chg: (num(o.bstp_nmix_prdy_ctrt) ?? 0) / 100 };
      } catch (e) { console.log("index", name, String(e)); }
    }
    const fx = (await usdkrw()) || tick.fx || null;
    // 오늘 지수 흐름: 09:00~15:35 정규장, 1분 간격 (미니 차트용)
    const series = tick.series?.date === date ? tick.series : { date, kospi: [], kosdaq: [] };
    if (hm >= 540 && hm <= 935) {
      for (const n of ["kospi", "kosdaq"]) {
        const sr = series[n] as [string, number][];
        if (idx[n]?.close && (!sr.length || sr[sr.length - 1][0] !== hhmm)) sr.push([hhmm, idx[n].close!]);
      }
    }
    await admin.from("live_cache").upsert({ id: 2, data: { updated_at: stamp, date, idx, fx, series }, updated_at: nowIso });

    // 4) [5분마다] 전 종목 시세 → live_cache id=1
    const { data: prevRow } = await admin.from("live_cache").select("data").eq("id", 1).maybeSingle();
    const prev = (prevRow?.data || {}) as Record<string, any>;
    const full = force || hm % 5 === 0 || prev.date !== date;
    if (!full) return json({ ok: true, tick: true, fx: fx?.rate ?? null });
    const list: unknown[][] = await (await fetch(STOCKS_URL, { cache: "no-store" })).json();
    const codes = list.map((r) => String(r[1])).filter((c) => /^\d{6}$/.test(c));
    // 넥스트레이드는 일부 종목만 거래 → 안 오는 종목은 같은 날 직전 값 유지
    const rows: Record<string, (number | null)[]> = prev.date === date && nxt ? { ...(prev.rows || {}) } : {};
    const chunks: string[][] = [];
    for (let i = 0; i < codes.length; i += 30) chunks.push(codes.slice(i, i + 30));
    let got = 0;
    const failed: number[] = [];
    const fetchChunk = async (k: number) => {
      const p: Record<string, string> = {};
      chunks[k].forEach((c, n) => { p[`FID_COND_MRKT_DIV_CODE_${n + 1}`] = market; p[`FID_INPUT_ISCD_${n + 1}`] = c; });
      const j = await kisGet(token, "/uapi/domestic-stock/v1/quotations/intstock-multprice", "FHKST11300006", p);
      for (const o of j.output || []) {
        const px = num(o.inter2_prpr);
        if (o.inter_shrn_iscd && px) { rows[o.inter_shrn_iscd] = [px, (num(o.prdy_ctrt) ?? 0) / 100, num(o.acml_tr_pbmn)]; got++; }
      }
    };
    // 30종목씩, 2줄로 나눠 동시에 (초당 20건 한도 아래)
    const worker = async (start: number) => {
      for (let k = start; k < chunks.length; k += 2) {
        try { await fetchChunk(k); } catch { failed.push(k); }
        await sleep(120);
      }
    };
    await Promise.all([worker(0), worker(1)]);
    // 한도에 걸린 묶음은 끝나고 천천히 한 번 더
    let fails = 0;
    for (const k of failed) {
      await sleep(400);
      try { await fetchChunk(k); } catch (e) { fails++; console.log("chunk", k, String(e)); }
    }
    if (got < 300 && !nxt) return json({ error: `받은 종목이 너무 적음(${got})`, fails }, 502);
    const data = {
      updated_at: stamp, date, session: nxt ? "nxt" : "regular", source: "한국투자증권" + (nxt ? " · NXT" : "") + " · 5분",
      kospi: idx.kospi || prev.kospi || null, idx, fx,
      fields: ["close", "chg", "amount"], rows,
    };
    const { error } = await admin.from("live_cache").upsert({ id: 1, data, updated_at: nowIso });
    if (error) throw error;
    return json({ ok: true, market, got, fails, total: codes.length, fx: fx?.rate ?? null });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
