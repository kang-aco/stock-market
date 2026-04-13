/**
 * Cloudflare Pages Function — /api/investors
 *
 * 한국투자증권 KIS OpenAPI를 통해 코스피/코스닥 투자자별 순매수 금액을 반환합니다.
 * API 호출 실패 시 mock 데이터를 반환하고 서버 로그에 오류를 기록합니다.
 *
 * 환경변수 (Cloudflare Pages → Settings → Environment Variables):
 *   KIS_APP_KEY    — 한국투자증권 앱 키
 *   KIS_APP_SECRET — 한국투자증권 앱 시크릿
 */

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const KIS_BASE_URL = "https://openapi.koreainvestment.com:9443";
const FETCH_TIMEOUT_MS = 8000; // KIS API는 응답이 느릴 수 있어 8초로 설정

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * KIS API 실패 시 반환할 mock 데이터
 */
const MOCK_DATA = {
  kospi:   { individual: -12000, institution:  8500, foreign:  3500 },
  kosdaq:  { individual:   5200, institution: -1800, foreign: -3400 },
  futures: { individual:   -800, institution:  1500, foreign:  -700 },
  unit:        "억원",
  futuresUnit: "계약",
  isMock: true,
};

// ─── KIS API 헬퍼 ─────────────────────────────────────────────────────────────

/**
 * AbortController를 이용한 fetch 래퍼 (타임아웃 지원)
 *
 * @param {string}  url
 * @param {object}  options  - fetch 옵션
 * @param {number}  timeoutMs
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * KIS OAuth2 액세스 토큰을 발급받습니다.
 *
 * @param {string} appKey
 * @param {string} appSecret
 * @returns {Promise<string>} access_token
 * @throws {Error} 토큰 발급 실패 시
 */
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

  if (!res.ok) {
    throw new Error(`KIS 토큰 발급 실패: HTTP ${res.status}`);
  }

  const json = await res.json();

  if (!json.access_token) {
    throw new Error("KIS 토큰 응답에 access_token 필드가 없습니다.");
  }

  return json.access_token;
}

/**
 * KIS 투자자별 순매수 조회 API를 호출합니다.
 *
 * @param {string} accessToken
 * @param {string} appKey
 * @param {string} appSecret
 * @param {"J"|"Q"} marketDivCode - J=코스피, Q=코스닥
 * @param {string}  inputIscd     - 코스피: "0001", 코스닥: "1001"
 * @returns {Promise<object>} output 배열의 첫 번째 요소
 * @throws {Error} API 호출 실패 시
 */
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

  if (!res.ok) {
    throw new Error(`KIS 투자자 조회 실패 (${marketDivCode}): HTTP ${res.status}`);
  }

  const json = await res.json();
  const output = json?.output;

  if (!Array.isArray(output) || output.length === 0) {
    throw new Error(`KIS 응답 output 배열이 비어있습니다 (${marketDivCode}).`);
  }

  // output[0]이 가장 최근 데이터
  return output[0];
}

/**
 * KIS API 응답의 순매수 금액 필드를 억원 단위로 변환합니다.
 * 원본 단위는 백만원이므로 /100 적용합니다.
 */
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

/**
 * KIS 선물 투자자별 순매수 계약수를 조회합니다.
 * 엔드포인트: /uapi/domestic-futureoption/v1/quotations/inquire-investor
 * tr_id: FHKIF03020100
 * FID_INPUT_ISCD: 101SC3 (코스피200 선물 근월물)
 */
async function fetchKisFuturesInvestorData(accessToken, appKey, appSecret) {
  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: "F",
    FID_INPUT_ISCD:         "101SC3",
  });

  const url = `${KIS_BASE_URL}/uapi/domestic-futureoption/v1/quotations/inquire-investor?${params}`;

  const res = await fetchWithTimeout(url, {
    method: "GET",
    headers: {
      "authorization": `Bearer ${accessToken}`,
      "appkey":        appKey,
      "appsecret":     appSecret,
      "tr_id":         "FHKIF03020100",
      "content-type":  "application/json",
    },
  });

  if (!res.ok) throw new Error(`KIS 선물 투자자 조회 실패: HTTP ${res.status}`);

  const json = await res.json();
  const output = json?.output;
  if (!Array.isArray(output) || output.length === 0) {
    throw new Error("KIS 선물 output 배열이 비어있습니다.");
  }

  return output[0];
}

/**
 * 선물 투자자 레코드 파싱 (단위: 계약수)
 * qty 필드 우선, 없으면 tr_pbmn 폴백
 */
function parseFuturesRecord(record) {
  const toInt = (qty, pbmn) => {
    // 계약수 필드 우선
    const q = parseInt(qty ?? "0", 10);
    if (!isNaN(q) && q !== 0) return q;
    // 없으면 금액(백만원) → 억원 변환
    const p = parseInt(pbmn ?? "0", 10);
    return isNaN(p) ? 0 : Math.round(p / 100);
  };
  return {
    individual:  toInt(record.prsn_ntby_qty, record.prsn_ntby_tr_pbmn),
    institution: toInt(record.orgn_ntby_qty,  record.orgn_ntby_tr_pbmn),
    foreign:     toInt(record.frgn_ntby_qty,  record.frgn_ntby_tr_pbmn),
  };
}

// ─── 메인 핸들러 ─────────────────────────────────────────────────────────────

export async function onRequest(context) {
  // OPTIONS 프리플라이트 처리
  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const appKey    = context.env.KIS_APP_KEY;
  const appSecret = context.env.KIS_APP_SECRET;

  // 환경변수 미설정 시 즉시 mock 반환 (개발 환경 대응)
  if (!appKey || !appSecret) {
    console.error("[investors.js] KIS_APP_KEY 또는 KIS_APP_SECRET 환경변수가 설정되지 않았습니다. mock 데이터를 반환합니다.");
    return new Response(
      JSON.stringify({ ...MOCK_DATA, updatedAt: new Date().toISOString() }),
      { status: 200, headers: CORS_HEADERS }
    );
  }

  try {
    // ── 1단계: 액세스 토큰 발급 ───────────────────────────────────────────────
    const accessToken = await fetchKisAccessToken(appKey, appSecret);

    // ── 2단계: 코스피·코스닥·선물 투자자 데이터 병렬 조회 ───────────────────
    const [kospiResult, kosdaqResult, futuresResult] = await Promise.allSettled([
      fetchKisInvestorData(accessToken, appKey, appSecret, "J", "0001"),
      fetchKisInvestorData(accessToken, appKey, appSecret, "Q", "1001"),
      fetchKisFuturesInvestorData(accessToken, appKey, appSecret),
    ]);

    // 현물(코스피·코스닥)이 하나라도 실패 → 전체 mock 폴백
    if (kospiResult.status === "rejected" || kosdaqResult.status === "rejected") {
      const reason = kospiResult.reason ?? kosdaqResult.reason;
      console.error("[investors.js] 현물 투자자 데이터 조회 실패:", reason);
      return new Response(
        JSON.stringify({ ...MOCK_DATA, updatedAt: new Date().toISOString() }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // ── 3단계: 응답 파싱 및 단위 변환 ────────────────────────────────────────
    const kospi  = parseInvestorRecord(kospiResult.value);
    const kosdaq = parseInvestorRecord(kosdaqResult.value);

    // 선물은 실패해도 mock으로 부분 폴백 (현물은 정상 반환)
    let futures = MOCK_DATA.futures;
    if (futuresResult.status === "fulfilled") {
      try {
        futures = parseFuturesRecord(futuresResult.value);
      } catch (e) {
        console.error("[investors.js] 선물 파싱 실패, mock 사용:", e);
      }
    } else {
      console.error("[investors.js] 선물 조회 실패, mock 사용:", futuresResult.reason);
    }

    const payload = {
      kospi,
      kosdaq,
      futures,
      unit:        "억원",
      futuresUnit: "계약",
      updatedAt: new Date().toISOString(),
    };

    return new Response(JSON.stringify(payload), {
      status:  200,
      headers: CORS_HEADERS,
    });

  } catch (err) {
    // 토큰 발급 실패 등 예상 외 오류 — mock 반환 후 서버 로그 기록
    console.error("[investors.js] KIS API 호출 중 오류 발생:", err?.message ?? err);

    return new Response(
      JSON.stringify({ ...MOCK_DATA, updatedAt: new Date().toISOString() }),
      { status: 200, headers: CORS_HEADERS }
    );
  }
}
