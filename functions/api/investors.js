/**
 * Cloudflare Pages Function — /api/investors
 *
 * 환경변수 (Cloudflare Pages → Settings → Environment Variables):
 *   KIS_APP_KEY    — 한국투자증권 앱 키
 *   KIS_APP_SECRET — 한국투자증권 앱 시크릿
 */

const KIS_BASE_URL    = "https://openapi.koreainvestment.com:9443";
const FETCH_TIMEOUT_MS = 8000;

const CORS_HEADERS = {
  "Content-Type":                "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods":"GET, OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type",
};

const MOCK_DATA = {
  kospi:   { individual: -12000, institution:  8500, foreign:  3500 },
  kosdaq:  { individual:   5200, institution: -1800, foreign: -3400 },
  futures: { individual:   -800, institution:  1500, foreign:  -700 },
  unit:        "억원",
  futuresUnit: "계약",
  isMock: true,
  mockReason: "KIS_APP_KEY/SECRET 미설정",
};

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url, options, ms = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
}

async function fetchKisAccessToken(appKey, appSecret) {
  const res = await fetchWithTimeout(
    `${KIS_BASE_URL}/oauth2/tokenP`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ grant_type: "client_credentials", appkey: appKey, appsecret: appSecret }),
    }
  );
  if (!res.ok) throw new Error(`토큰 발급 실패: HTTP ${res.status}`);
  const json = await res.json();
  if (!json.access_token) throw new Error("토큰 응답에 access_token 없음");
  return json.access_token;
}

async function fetchKisInvestorData(token, appKey, appSecret, mktDiv, iscd) {
  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: mktDiv,
    FID_INPUT_ISCD:         iscd,
  });
  const res = await fetchWithTimeout(
    `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-investor?${params}`,
    {
      method:  "GET",
      headers: {
        authorization: `Bearer ${token}`,
        appkey:        appKey,
        appsecret:     appSecret,
        tr_id:         "FHKST01010900",
        "content-type":"application/json",
      },
    }
  );
  if (!res.ok) throw new Error(`KIS 투자자 조회 실패 (${mktDiv}): HTTP ${res.status}`);
  const json = await res.json();

  // KIS API 에러 코드 승인
  if (json.rt_cd && json.rt_cd !== "0") {
    throw new Error(`KIS API 오류: rt_cd=${json.rt_cd} msg=${json.msg1}`);
  }

  const output = json?.output;
  if (!Array.isArray(output) || output.length === 0)
    throw new Error(`output 배열 비어있음 (${mktDiv})`);
  return output[0];
}

async function fetchKisFuturesInvestorData(token, appKey, appSecret) {
  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: "F",
    FID_INPUT_ISCD:         "101SC3",
  });
  const res = await fetchWithTimeout(
    `${KIS_BASE_URL}/uapi/domestic-futureoption/v1/quotations/inquire-investor?${params}`,
    {
      method:  "GET",
      headers: {
        authorization: `Bearer ${token}`,
        appkey:        appKey,
        appsecret:     appSecret,
        tr_id:         "FHKIF03020100",
        "content-type":"application/json",
      },
    }
  );
  if (!res.ok) throw new Error(`KIS 선물 조회 실패: HTTP ${res.status}`);
  const json = await res.json();

  if (json.rt_cd && json.rt_cd !== "0")
    throw new Error(`KIS 선물 API 오류: rt_cd=${json.rt_cd} msg=${json.msg1}`);

  const output = json?.output;
  if (!Array.isArray(output) || output.length === 0)
    throw new Error("선물 output 비어있음");
  return output[0];
}

function parseInvestorRecord(record) {
  const toEok = (val) => {
    const n = parseInt(val ?? "0", 10);
    return isNaN(n) ? 0 : Math.round(n / 100);
  };
  return {
    individual:  toEok(record.prsn_ntby_tr_pbmn),
    institution: toEok(record.orgn_ntby_tr_pbmn),
    foreign:     toEok(record.frgn_ntby_tr_pbmn),
  };
}

function parseFuturesRecord(record) {
  const toInt = (qty, pbmn) => {
    const q = parseInt(qty  ?? "0", 10);
    if (!isNaN(q) && q !== 0) return q;
    const p = parseInt(pbmn ?? "0", 10);
    return isNaN(p) ? 0 : Math.round(p / 100);
  };
  return {
    individual:  toInt(record.prsn_ntby_qty, record.prsn_ntby_tr_pbmn),
    institution: toInt(record.orgn_ntby_qty, record.orgn_ntby_tr_pbmn),
    foreign:     toInt(record.frgn_ntby_qty, record.frgn_ntby_tr_pbmn),
  };
}

// ─── 메인 핸들러 ─────────────────────────────────────────────────────────────

export async function onRequest(context) {
  if (context.request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS_HEADERS });

  const appKey    = context.env.KIS_APP_KEY;
  const appSecret = context.env.KIS_APP_SECRET;

  if (!appKey || !appSecret) {
    console.warn("[investors] KIS 환경변수 미설정 — mock 반환");
    return new Response(
      JSON.stringify({ ...MOCK_DATA, mockReason: "KIS_APP_KEY/SECRET 미설정", updatedAt: new Date().toISOString() }),
      { status: 200, headers: CORS_HEADERS }
    );
  }

  let accessToken;
  try {
    accessToken = await fetchKisAccessToken(appKey, appSecret);
  } catch (err) {
    console.error("[investors] 토큰 발급 실패:", err.message);
    return new Response(
      JSON.stringify({ ...MOCK_DATA, mockReason: `토큰 발급 실패: ${err.message}`, updatedAt: new Date().toISOString() }),
      { status: 200, headers: CORS_HEADERS }
    );
  }

  const [kospiResult, kosdaqResult, futuresResult] = await Promise.allSettled([
    fetchKisInvestorData(accessToken, appKey, appSecret, "J", "0001"),
    fetchKisInvestorData(accessToken, appKey, appSecret, "Q", "1001"),
    fetchKisFuturesInvestorData(accessToken, appKey, appSecret),
  ]);

  // 현물 실패 시 전체 mock
  if (kospiResult.status === "rejected" || kosdaqResult.status === "rejected") {
    const reason = (kospiResult.reason ?? kosdaqResult.reason)?.message ?? "현수 API 실패";
    console.error("[investors] 현수 조회 실패:", reason);
    return new Response(
      JSON.stringify({ ...MOCK_DATA, mockReason: reason, updatedAt: new Date().toISOString() }),
      { status: 200, headers: CORS_HEADERS }
    );
  }

  const kospi  = parseInvestorRecord(kospiResult.value);
  const kosdaq = parseInvestorRecord(kosdaqResult.value);

  let futures    = MOCK_DATA.futures;
  let futuresMock = true;
  if (futuresResult.status === "fulfilled") {
    try {
      futures     = parseFuturesRecord(futuresResult.value);
      futuresMock = false;
    } catch (e) {
      console.error("[investors] 선물 파싱 실패:", e.message);
    }
  } else {
    console.warn("[investors] 선물 조회 실패:", futuresResult.reason?.message);
  }

  return new Response(
    JSON.stringify({
      kospi,
      kosdaq,
      futures,
      unit:        "억원",
      futuresUnit: futuresMock ? "계약(mock)" : "계약",
      isMock:      false,
      futuresMock,
      updatedAt: new Date().toISOString(),
    }),
    { status: 200, headers: CORS_HEADERS }
  );
}
