/**
 * Cloudflare Pages Function — /api/investors
 *
 * 환경변수:
 *   KIS_APP_KEY    — 한국투자증권 앱 키
 *   KIS_APP_SECRET — 한국투자증권 앱 시크릿
 *
 * ⚠️  KIS OpenAPI는 IP 화이트리스트를 사용합니다.
 *     Cloudflare Pages에서 호출시 403이 발생하면:
 *     apiportal.koreainvestment.com → 앱 설정 → IP제한 → "사용안함"으로 변경하세요.
 */

const KIS_BASE     = "https://openapi.koreainvestment.com:9443";
const TIMEOUT_MS   = 8000;

const CORS = {
  "Content-Type":                "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods":"GET, OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type",
};

const MOCK = {
  kospi:   { individual: -12000, institution:  8500, foreign:  3500 },
  kosdaq:  { individual:   5200, institution: -1800, foreign: -3400 },
  futures: { individual:   -800, institution:  1500, foreign:  -700 },
  unit: "억원", futuresUnit: "계약",
  isMock: true,
};

// ─── 헬퍼 ───────────────────────────────────────────────────────────────────

async function withTimeout(url, opts, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), ms);
  try   { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(tid); }
}

async function fetchToken(appKey, appSecret) {
  const res = await withTimeout(
    `${KIS_BASE}/oauth2/tokenP`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ grant_type: "client_credentials", appkey: appKey, appsecret: appSecret }),
    }
  );

  if (!res.ok) {
    // 응답 본문에서 KIS 오류 코드를 추출해 상세 메시지 반환
    let detail = '';
    try {
      const body = await res.json();
      detail = body.error_description || body.msg1 || body.message || JSON.stringify(body);
    } catch (_) {
      try { detail = await res.text(); } catch (_2) {}
    }

    if (res.status === 403) {
      throw new Error(
        `HTTP 403 — IP 제한 또는 앱키 권한 문제입니다. ` +
        `KIS 포털(apiportal.koreainvestment.com) → 앱 설정 → IP제한 → "사용안함" 설정 필요. ` +
        (detail ? `[KIS응답: ${detail}]` : '')
      );
    }
    if (res.status === 401) {
      throw new Error(
        `HTTP 401 — APP KEY 또는 SECRET이 올바르지 않습니다. ` +
        `Cloudflare Pages 환경변수를 다시 확인하세요. ` +
        (detail ? `[KIS응답: ${detail}]` : '')
      );
    }
    throw new Error(`토큰 발급 HTTP ${res.status}${detail ? ': ' + detail : ''}`);
  }

  const json = await res.json();
  if (!json.access_token) throw new Error("access_token 필드 없음");
  return json.access_token;
}

async function fetchInvestor(token, appKey, appSecret, mktDiv, iscd) {
  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: mktDiv,
    FID_INPUT_ISCD:         iscd,
  });
  const res = await withTimeout(
    `${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-investor?${params}`,
    {
      method:  "GET",
      headers: {
        authorization: `Bearer ${token}`,
        appkey: appKey, appsecret: appSecret,
        tr_id: "FHKST01010900",
        "content-type": "application/json",
      },
    }
  );
  if (!res.ok) throw new Error(`투자자 조회 HTTP ${res.status} (${mktDiv})`);
  const json = await res.json();
  if (json.rt_cd && json.rt_cd !== "0")
    throw new Error(`KIS 오류: rt_cd=${json.rt_cd} msg=${json.msg1}`);
  const out = json?.output;
  if (!Array.isArray(out) || !out.length) throw new Error(`output 비어있음 (${mktDiv})`);
  return out[0];
}

async function fetchFutures(token, appKey, appSecret) {
  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: "F",
    FID_INPUT_ISCD:         "101SC3",
  });
  const res = await withTimeout(
    `${KIS_BASE}/uapi/domestic-futureoption/v1/quotations/inquire-investor?${params}`,
    {
      method:  "GET",
      headers: {
        authorization: `Bearer ${token}`,
        appkey: appKey, appsecret: appSecret,
        tr_id: "FHKIF03020100",
        "content-type": "application/json",
      },
    }
  );
  if (!res.ok) throw new Error(`선물 조회 HTTP ${res.status}`);
  const json = await res.json();
  if (json.rt_cd && json.rt_cd !== "0")
    throw new Error(`선물 KIS 오류: rt_cd=${json.rt_cd} msg=${json.msg1}`);
  const out = json?.output;
  if (!Array.isArray(out) || !out.length) throw new Error("선물 output 비어있음");
  return out[0];
}

function parseSpot(r) {
  const toEok = v => { const n = parseInt(v ?? "0", 10); return isNaN(n) ? 0 : Math.round(n / 100); };
  return {
    individual:  toEok(r.prsn_ntby_tr_pbmn),
    institution: toEok(r.orgn_ntby_tr_pbmn),
    foreign:     toEok(r.frgn_ntby_tr_pbmn),
  };
}

function parseFut(r) {
  const toInt = (q, p) => {
    const qv = parseInt(q ?? "0", 10);
    if (!isNaN(qv) && qv !== 0) return qv;
    const pv = parseInt(p ?? "0", 10);
    return isNaN(pv) ? 0 : Math.round(pv / 100);
  };
  return {
    individual:  toInt(r.prsn_ntby_qty, r.prsn_ntby_tr_pbmn),
    institution: toInt(r.orgn_ntby_qty, r.orgn_ntby_tr_pbmn),
    foreign:     toInt(r.frgn_ntby_qty, r.frgn_ntby_tr_pbmn),
  };
}

// ─── 메인 ───────────────────────────────────────────────────────────────────

export async function onRequest(context) {
  if (context.request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS });

  const appKey    = context.env.KIS_APP_KEY;
  const appSecret = context.env.KIS_APP_SECRET;

  if (!appKey || !appSecret) {
    return new Response(
      JSON.stringify({ ...MOCK, mockReason: "KIS_APP_KEY / KIS_APP_SECRET 환경변수 미설정", updatedAt: new Date().toISOString() }),
      { status: 200, headers: CORS }
    );
  }

  // 토큰 발급
  let token;
  try {
    token = await fetchToken(appKey, appSecret);
  } catch (err) {
    console.error("[investors] 토큰 실패:", err.message);
    return new Response(
      JSON.stringify({ ...MOCK, mockReason: err.message, updatedAt: new Date().toISOString() }),
      { status: 200, headers: CORS }
    );
  }

  // 코스피 · 코스닥 · 선물 병렬 조회
  const [kospiR, kosdaqR, futR] = await Promise.allSettled([
    fetchInvestor(token, appKey, appSecret, "J", "0001"),
    fetchInvestor(token, appKey, appSecret, "Q", "1001"),
    fetchFutures(token, appKey, appSecret),
  ]);

  if (kospiR.status === "rejected" || kosdaqR.status === "rejected") {
    const reason = (kospiR.reason ?? kosdaqR.reason)?.message ?? "현물 API 실패";
    console.error("[investors] 현물 실패:", reason);
    return new Response(
      JSON.stringify({ ...MOCK, mockReason: reason, updatedAt: new Date().toISOString() }),
      { status: 200, headers: CORS }
    );
  }

  const kospi  = parseSpot(kospiR.value);
  const kosdaq = parseSpot(kosdaqR.value);

  let futures     = MOCK.futures;
  let futuresMock = true;
  if (futR.status === "fulfilled") {
    try   { futures = parseFut(futR.value); futuresMock = false; }
    catch (e) { console.error("[investors] 선물 파싱 실패:", e.message); }
  } else {
    console.warn("[investors] 선물 실패:", futR.reason?.message);
  }

  return new Response(
    JSON.stringify({
      kospi, kosdaq, futures,
      unit: "억원",
      futuresUnit: futuresMock ? "계약(mock)" : "계약",
      isMock:      false,
      futuresMock,
      updatedAt: new Date().toISOString(),
    }),
    { status: 200, headers: CORS }
  );
}
