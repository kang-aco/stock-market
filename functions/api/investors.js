/**
 * Cloudflare Pages Function — /api/investors
 *
 * 한국투자증권 KIS OpenAPI를 통해 코스피/코스닥 투자자별 순매수 금액을 반환합니다.
 * API 호출 실패 시 mock 데이터를 반환하고 서버 로그에 오류를 기록합니다.
 *
 * 환경변수:
 *   KIS_APP_KEY    — 한국투자증권 앱 키
 *   KIS_APP_SECRET — 한국투자증권 앱 시크릿
 */

const KIS_BASE_URL = "https://openapi.koreainvestment.com:9443";
const FETCH_TIMEOUT_MS = 8000;

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MOCK_DATA = {
  kospi:  { individual: -12000, institution: 8500,  foreign: 3500  },
  kosdaq: { individual:  5200,  institution: -1800, foreign: -3400 },
  unit:   "억원",
  isMock: true,
};

async function fetchWithTimeout(url, options, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchKisAccessToken(appKey, appSecret) {
  const res = await fetchWithTimeout(
    `${KIS_BASE_URL}/oauth2/tokenP`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        appkey:     appKey,
        appsecret:  appSecret,
      }),
    }
  );

  if (!res.ok) throw new Error(`KIS 토큰 발급 실패: HTTP ${res.status}`);

  const json = await res.json();
  if (!json.access_token) throw new Error("KIS 토큰 응답에 access_token 필드가 없습니다.");

  return json.access_token;
}

async function fetchKisInvestorData(accessToken, appKey, appSecret, marketDivCode, inputIscd) {
  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: marketDivCode,
    FID_INPUT_ISCD:         inputIscd,
  });

  const url = `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-investor?${params}`;

  const res = await fetchWithTimeout(url, {
    method: "GET",
    headers: {
      "authorization": `Bearer ${accessToken}`,
      "appkey":        appKey,
      "appsecret":     appSecret,
      "tr_id":         "FHKST01010900",
      "content-type":  "application/json",
    },
  });

  if (!res.ok) throw new Error(`KIS 투자자 조회 실패 (${marketDivCode}): HTTP ${res.status}`);

  const json = await res.json();
  const output = json?.output;

  if (!Array.isArray(output) || output.length === 0) {
    throw new Error(`KIS 응답 output 배열이 비어있습니다 (${marketDivCode}).`);
  }

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

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const appKey    = context.env.KIS_APP_KEY;
  const appSecret = context.env.KIS_APP_SECRET;

  if (!appKey || !appSecret) {
    console.error("[investors.js] KIS_APP_KEY 또는 KIS_APP_SECRET 환경변수가 설정되지 않았습니다. mock 데이터를 반환합니다.");
    return new Response(
      JSON.stringify({ ...MOCK_DATA, updatedAt: new Date().toISOString() }),
      { status: 200, headers: CORS_HEADERS }
    );
  }

  try {
    const accessToken = await fetchKisAccessToken(appKey, appSecret);

    const [kospiResult, kosdaqResult] = await Promise.allSettled([
      fetchKisInvestorData(accessToken, appKey, appSecret, "J", "0001"),
      fetchKisInvestorData(accessToken, appKey, appSecret, "Q", "1001"),
    ]);

    if (kospiResult.status === "rejected" || kosdaqResult.status === "rejected") {
      const reason = kospiResult.reason ?? kosdaqResult.reason;
      console.error("[investors.js] 투자자 데이터 조회 실패:", reason);
      return new Response(
        JSON.stringify({ ...MOCK_DATA, updatedAt: new Date().toISOString() }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    const kospi  = parseInvestorRecord(kospiResult.value);
    const kosdaq = parseInvestorRecord(kosdaqResult.value);

    return new Response(
      JSON.stringify({ kospi, kosdaq, unit: "억원", updatedAt: new Date().toISOString() }),
      { status: 200, headers: CORS_HEADERS }
    );

  } catch (err) {
    console.error("[investors.js] KIS API 호출 중 오류 발생:", err?.message ?? err);
    return new Response(
      JSON.stringify({ ...MOCK_DATA, updatedAt: new Date().toISOString() }),
      { status: 200, headers: CORS_HEADERS }
    );
  }
}
