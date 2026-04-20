/**
 * Cloudflare Pages Function — /api/market
 *
 * - 지수/환율/유가: Yahoo Finance (공개 API)
 * - 필승코리아 펀드 종목 주가: KIS OpenAPI (KIS_APP_KEY, KIS_APP_SECRET 환경변수 필요)
 *   환경변수 미설정 시 Yahoo Finance로 자동 대체
 *
 * 환경변수 (Cloudflare Pages → Settings → Environment Variables):
 *   KIS_APP_KEY    — 한국투자증권 앱 키
 *   KIS_APP_SECRET — 한국투자증권 앱 시크릿
 */

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const KIS_BASE_URL = "https://openapi.koreainvestment.com:9443";

// ─── 티커 정의 ────────────────────────────────────────────────────────────────

const INDEX_TICKERS = [
  { ticker: "^KS11",  id: "KOSPI",      name: "코스피",         optional: false },
  { ticker: "^KQ11",  id: "KOSDAQ",     name: "코스닥",         optional: false },
  { ticker: "^KS200", id: "KOSPI200F",  name: "코스피200",      optional: false },
  { ticker: "^KQ150", id: "KOSDAQ150F", name: "코스닥150선물",  optional: true  },
  { ticker: "^DJI",   id: "DOW",        name: "다우존스",       optional: false },
  { ticker: "^IXIC",  id: "NASDAQ",     name: "나스닥",         optional: false },
  { ticker: "^SOX",   id: "SOX",        name: "필라델피아반도체", optional: false },
];

// kisCode: KIS API용 종목코드 (6자리), ticker: Yahoo Finance 폴백용
const STOCK_TICKERS = [
  { ticker: "005930.KS", kisCode: "005930", name: "삼성전자" },
  { ticker: "000660.KS", kisCode: "000660", name: "SK하이닉스" },
  { ticker: "005380.KS", kisCode: "005380", name: "현대차" },
  { ticker: "000270.KS", kisCode: "000270", name: "기아" },
  { ticker: "373220.KS", kisCode: "373220", name: "LG에너지솔루션" },
  { ticker: "005490.KS", kisCode: "005490", name: "POSCO홀딩스" },
  { ticker: "068270.KS", kisCode: "068270", name: "셀트리온" },
  { ticker: "207940.KS", kisCode: "207940", name: "삼성바이오로직스" },
  { ticker: "105560.KS", kisCode: "105560", name: "KB금융" },
  { ticker: "055550.KS", kisCode: "055550", name: "신한지주" },
];

const FX_TICKERS = [
  { ticker: "KRW=X",    id: "USD/KRW", jpyScale: false },
  { ticker: "EURKRW=X", id: "EUR/KRW", jpyScale: false },
  // JPY/KRW: Yahoo Finance가 1엔 기준으로 반환하므로 ×100 적용
  { ticker: "JPYKRW=X", id: "JPY/KRW", jpyScale: true },
];

const OIL_TICKERS = [
  { ticker: "CL=F", id: "WTI",   name: "WTI 원유" },
  { ticker: "BZ=F", id: "BRENT", name: "브렌트유" },
];

// ─── KIS API 헬퍼 ─────────────────────────────────────────────────────────────

/**
 * KIS OAuth2 액세스 토큰을 발급받습니다.
 */
async function fetchKisAccessToken(appKey, appSecret) {
  const res = await fetch(`${KIS_BASE_URL}/oauth2/tokenP`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", appkey: appKey, appsecret: appSecret }),
  });
  if (!res.ok) throw new Error(`KIS 토큰 발급 실패: HTTP ${res.status}`);
  const json = await res.json();
  if (!json.access_token) throw new Error("KIS 토큰 응답에 access_token 없음");
  return json.access_token;
}

/**
 * KIS 주식현재가 API로 단일 종목 시세를 조회합니다.
 * prdy_vrss_sign: '1'=상한 '2'=상승 '3'=보합 '4'=하한 '5'=하락
 *
 * @returns {{ price, change, changeRate, volume }|null}
 */
async function fetchKisStockQuote(accessToken, appKey, appSecret, kisCode) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const params = new URLSearchParams({ FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: kisCode });
    const url = `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price?${params}`;
    const res = await fetch(url, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "authorization": `Bearer ${accessToken}`,
        "appkey":        appKey,
        "appsecret":     appSecret,
        "tr_id":         "FHKST01010100",
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    const o = json?.output;
    if (!o) return null;

    const price = parseFloat(o.stck_prpr);
    if (isNaN(price) || price === 0) return null;

    const rawChange = parseFloat(o.prdy_vrss) || 0;
    const rawRate   = parseFloat(o.prdy_ctrt)  || 0;
    const sign      = o.prdy_vrss_sign;
    const neg       = sign === "4" || sign === "5";
    const flat      = sign === "3";

    const change     = flat ? 0 : neg ? -Math.abs(rawChange) : Math.abs(rawChange);
    const changeRate = flat ? 0 : neg ? -Math.abs(rawRate)   : Math.abs(rawRate);
    const volume     = parseInt(o.acml_vol, 10);

    return {
      price:      round(price, 0),
      change:     round(change, 0),
      changeRate: round(changeRate, 2),
      volume:     isNaN(volume) ? null : volume,
    };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── 공통 헬퍼 ────────────────────────────────────────────────────────────────

/**
 * CORS 응답 헤더
 */
const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * Yahoo Finance v8 chart API에서 단일 티커 데이터를 가져옵니다.
 * 5초 타임아웃을 적용하며, 실패 시 null을 반환합니다.
 *
 * @param {string} ticker - Yahoo Finance 티커 심볼
 * @returns {Promise<object|null>} 파싱된 응답 JSON 또는 null
 */
async function fetchYahooTicker(ticker) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: controller.signal,
    });

    if (!res.ok) return null;

    const json = await res.json();
    return json;
  } catch (_err) {
    // 타임아웃 또는 네트워크 오류 — null로 처리
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Yahoo Finance 응답 JSON에서 핵심 수치를 추출합니다.
 *
 * @param {object|null} json     - fetchYahooTicker 반환값
 * @param {boolean}     jpyScale - true이면 가격에 ×100 적용 (JPY/KRW 전용)
 * @returns {{ price, prevClose, change, changeRate, sparkline, volume }|null}
 */
function extractQuote(json, jpyScale = false) {
  try {
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta;
    let price    = meta?.regularMarketPrice ?? null;
    let prevClose = meta?.regularMarketPreviousClose ?? meta?.previousClose ?? meta?.chartPreviousClose ?? null;

    if (price === null || price === undefined) return null;

    // JPY/KRW는 1엔 기준이므로 100엔 기준으로 환산
    if (jpyScale) {
      price     = price     !== null ? price * 100     : null;
      prevClose = prevClose !== null ? prevClose * 100 : null;
    }

    // Yahoo Finance가 제공하는 공식 등락값·등락률을 우선 사용 (직접 계산보다 정확)
    // jpyScale(JPY/KRW)은 Yahoo가 1엔 기준이므로 직접 계산 유지
    let change, changeRate;
    if (!jpyScale && meta?.regularMarketChange !== undefined && meta?.regularMarketChangePercent !== undefined) {
      change     = meta.regularMarketChange;
      changeRate = meta.regularMarketChangePercent;
    } else {
      change     = prevClose !== null ? price - prevClose : null;
      changeRate = (change !== null && prevClose) ? (change / prevClose) * 100 : null;
    }

    // sparkline: close 배열에서 null 제거 후 마지막 20개
    const rawClose = result.indicators?.quote?.[0]?.close ?? [];
    const sparkline = rawClose
      .filter((v) => v !== null && v !== undefined)
      .slice(-20)
      .map((v) => jpyScale ? v * 100 : v);

    const volume = meta?.regularMarketVolume ?? null;

    return {
      price:      round(price, 2),
      prevClose:  round(prevClose, 2),
      change:     round(change, 2),
      changeRate: round(changeRate, 2),
      sparkline,
      volume,
    };
  } catch (_err) {
    return null;
  }
}

/**
 * 소수점 자릿수 반올림 헬퍼 (null 안전)
 */
function round(val, digits) {
  if (val === null || val === undefined) return null;
  return parseFloat(val.toFixed(digits));
}

/**
 * Yahoo Finance로 STOCK_TICKERS 주가를 조회하는 폴백 함수
 */
async function fetchStocksFromYahoo() {
  const results = await Promise.allSettled(
    STOCK_TICKERS.map((def) => fetchYahooTicker(def.ticker))
  );
  return STOCK_TICKERS
    .map((def, i) => {
      const json = results[i].status === "fulfilled" ? results[i].value : null;
      const q = extractQuote(json);
      if (!q) return null;
      return { id: def.ticker, name: def.name, price: q.price, change: q.change, changeRate: q.changeRate, volume: q.volume };
    })
    .filter(Boolean);
}

// ─── 장 상태 판단 (KST 기준) ─────────────────────────────────────────────────

/**
 * 현재 KST(UTC+9) 시간을 기준으로 장 상태를 반환합니다.
 * - 09:00~15:30 → "OPEN"
 * - 08:00~09:00 → "PRE_MARKET"
 * - 그 외        → "CLOSED"
 *
 * @returns {"OPEN"|"PRE_MARKET"|"CLOSED"}
 */
function getMarketStatus() {
  const now = new Date();
  // KST = UTC + 9시간
  const kstMinutes = (now.getUTCHours() * 60 + now.getUTCMinutes() + 9 * 60) % (24 * 60);

  const OPEN_START  = 9  * 60;       // 540
  const OPEN_END    = 15 * 60 + 30;  // 930
  const PRE_START   = 8  * 60;       // 480

  if (kstMinutes >= OPEN_START && kstMinutes < OPEN_END) return "OPEN";
  if (kstMinutes >= PRE_START  && kstMinutes < OPEN_START) return "PRE_MARKET";
  return "CLOSED";
}

// ─── 메인 핸들러 ─────────────────────────────────────────────────────────────

export async function onRequest(context) {
  // OPTIONS 프리플라이트 처리
  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    const appKey    = context.env?.KIS_APP_KEY;
    const appSecret = context.env?.KIS_APP_SECRET;

    // ── 지수·환율·유가: Yahoo Finance 병렬 수집 ──────────────────────────────
    const yahooTickers = [
      ...INDEX_TICKERS.map((d) => ({ ...d, group: "index" })),
      ...FX_TICKERS.map((d)    => ({ ...d, group: "fx"    })),
      ...OIL_TICKERS.map((d)   => ({ ...d, group: "oil"   })),
    ];

    const yahooResults = await Promise.allSettled(
      yahooTickers.map((item) => fetchYahooTicker(item.ticker))
    );

    const quoteMap = {};
    yahooResults.forEach((result, i) => {
      const item = yahooTickers[i];
      const json = result.status === "fulfilled" ? result.value : null;
      const isJpy = item.ticker === "JPYKRW=X";
      quoteMap[item.ticker] = extractQuote(json, isJpy);
    });

    // ── indices ──────────────────────────────────────────────────────────────
    const indices = INDEX_TICKERS.map((def) => {
      const q = quoteMap[def.ticker];
      return {
        id:         def.id,
        name:       def.name,
        value:      q?.price      ?? null,
        change:     q?.change     ?? null,
        changeRate: q?.changeRate ?? null,
        sparkline:  q?.sparkline  ?? [],
      };
    });

    // ── stocks: KIS API 우선, 미설정 시 Yahoo Finance 폴백 ───────────────────
    let stocks;
    if (appKey && appSecret) {
      try {
        const accessToken = await fetchKisAccessToken(appKey, appSecret);
        const kisResults = await Promise.allSettled(
          STOCK_TICKERS.map((def) => fetchKisStockQuote(accessToken, appKey, appSecret, def.kisCode))
        );
        stocks = STOCK_TICKERS
          .map((def, i) => {
            const q = kisResults[i].status === "fulfilled" ? kisResults[i].value : null;
            if (!q) return null;
            return { id: def.ticker, name: def.name, price: q.price, change: q.change, changeRate: q.changeRate, volume: q.volume };
          })
          .filter(Boolean);
      } catch (kisErr) {
        console.error("[market.js] KIS 주가 조회 실패, Yahoo Finance로 대체:", kisErr?.message);
        stocks = await fetchStocksFromYahoo();
      }
    } else {
      stocks = await fetchStocksFromYahoo();
    }

    // ── fx ───────────────────────────────────────────────────────────────────
    const fx = FX_TICKERS
      .map((def) => {
        const q = quoteMap[def.ticker];
        if (!q) return null;
        return {
          id:         def.id,
          value:      q.price,
          change:     q.change,
          changeRate: q.changeRate,
        };
      })
      .filter(Boolean);

    // ── oil ───────────────────────────────────────────────────────────────────
    const oil = OIL_TICKERS
      .map((def) => {
        const q = quoteMap[def.ticker];
        if (!q) return null;
        return {
          id:         def.id,
          name:       def.name,
          value:      q.price,
          change:     q.change,
          changeRate: q.changeRate,
        };
      })
      .filter(Boolean);

    // ── 응답 조립 ─────────────────────────────────────────────────────────────
    const payload = {
      indices,
      stocks,
      fx,
      oil,
      updatedAt:    new Date().toISOString(),
      marketStatus: getMarketStatus(),
    };

    return new Response(JSON.stringify(payload), {
      status:  200,
      headers: CORS_HEADERS,
    });

  } catch (err) {
    // 예상치 못한 서버 오류 — 스택 트레이스는 클라이언트에 노출하지 않습니다.
    console.error("[market.js] Unhandled error:", err);

    return new Response(
      JSON.stringify({
        success: false,
        error: { code: "INTERNAL_ERROR", message: "시장 데이터 수집 중 오류가 발생했습니다." },
      }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
