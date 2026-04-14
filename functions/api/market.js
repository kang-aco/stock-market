/**
 * Cloudflare Pages Function — /api/market
 *
 * Yahoo Finance에서 국내외 지수, 필승코리아 펀드 종목, 환율, 유가 데이터를
 * 병렬로 수집해 실시간 대시보드용 JSON을 반환합니다.
 *
 * 환경변수: 없음 (Yahoo Finance는 공개 API)
 */

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

const STOCK_TICKERS = [
  { ticker: "005930.KS", name: "삼성전자" },
  { ticker: "000660.KS", name: "SK하이닉스" },
  { ticker: "005380.KS", name: "현대차" },
  { ticker: "000270.KS", name: "기아" },
  { ticker: "373220.KS", name: "LG에너지솔루션" },
  { ticker: "005490.KS", name: "POSCO홀딩스" },
  { ticker: "068270.KS", name: "셀트리온" },
  { ticker: "207940.KS", name: "삼성바이오로직스" },
  { ticker: "105560.KS", name: "KB금융" },
  { ticker: "055550.KS", name: "신한지주" },
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
    // regularMarketPreviousClose(전일 공식 종가)를 우선 사용,
    // 없을 경우에만 chartPreviousClose(차트 기준 종가)로 fallback
    let prevClose = meta?.regularMarketPreviousClose ?? meta?.previousClose ?? meta?.chartPreviousClose ?? null;

    if (price === null || price === undefined) return null;

    // JPY/KRW는 1엔 기준이므로 100엔 기준으로 환산
    if (jpyScale) {
      price     = price     !== null ? price * 100     : null;
      prevClose = prevClose !== null ? prevClose * 100 : null;
    }

    const change     = prevClose !== null ? price - prevClose : null;
    const changeRate = (change !== null && prevClose) ? (change / prevClose) * 100 : null;

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
    // ── 모든 티커를 단일 Promise.allSettled로 병렬 수집 ──────────────────────
    // 실패한 티커는 null로 처리되며 필터링됩니다.

    const allTickers = [
      ...INDEX_TICKERS.map((d) => ({ ...d, group: "index" })),
      ...STOCK_TICKERS.map((d) => ({ ...d, group: "stock" })),
      ...FX_TICKERS.map((d)    => ({ ...d, group: "fx"    })),
      ...OIL_TICKERS.map((d)   => ({ ...d, group: "oil"   })),
    ];

    const results = await Promise.allSettled(
      allTickers.map((item) => fetchYahooTicker(item.ticker))
    );

    // results[i] 와 allTickers[i] 는 인덱스가 일치합니다.
    const quoteMap = {};
    results.forEach((result, i) => {
      const item = allTickers[i];
      const json = result.status === "fulfilled" ? result.value : null;
      const isJpy = item.ticker === "JPYKRW=X";
      quoteMap[item.ticker] = extractQuote(json, isJpy);
    });

    // ── indices ──────────────────────────────────────────────────────────────
    const indices = INDEX_TICKERS.map((def) => {
      const q = quoteMap[def.ticker];

      // optional 티커(코스닥150선물)는 데이터가 없어도 value:null로 포함
      return {
        id:         def.id,
        name:       def.name,
        value:      q?.price      ?? null,
        change:     q?.change     ?? null,
        changeRate: q?.changeRate ?? null,
        sparkline:  q?.sparkline  ?? [],
      };
    });

    // ── stocks ───────────────────────────────────────────────────────────────
    const stocks = STOCK_TICKERS
      .map((def) => {
        const q = quoteMap[def.ticker];
        if (!q) return null; // 실패한 종목은 제외
        return {
          id:         def.ticker,
          name:       def.name,
          price:      q.price,
          change:     q.change,
          changeRate: q.changeRate,
          volume:     q.volume,
        };
      })
      .filter(Boolean);

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
