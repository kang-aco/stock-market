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
  { ticker: "NK=F",   id: "KOSPI200F",  name: "코스피200선물",  optional: false },
  { ticker: "^KQ150", id: "KOSDAQ150F", name: "코스닥150선물",  optional: true  },
  { ticker: "^DJI",   id: "DOW",        name: "다우존스",       optional: false },
  { ticker: "^IXIC",  id: "NASDAQ",     name: "나스닥",         optional: false },
  { ticker: "^SOX",   id: "SOX",        name: "필라델피아반도체", optional: false },
];

// 편입비율(ratio)은 필승코리아 펀드 기준 참고값 (%)
const STOCK_TICKERS = [
  { ticker: "005930.KS", name: "삼성전자",         ratio: 24.51 },
  { ticker: "000660.KS", name: "SK하이닉스",       ratio:  7.83 },
  { ticker: "005380.KS", name: "현대차",           ratio:  4.62 },
  { ticker: "000270.KS", name: "기아",             ratio:  3.94 },
  { ticker: "373220.KS", name: "LG에너지솔루션",   ratio:  3.41 },
  { ticker: "005490.KS", name: "POSCO홀딩스",      ratio:  2.73 },
  { ticker: "068270.KS", name: "셀트리온",         ratio:  2.58 },
  { ticker: "207940.KS", name: "삼성바이오로직스", ratio:  2.47 },
  { ticker: "105560.KS", name: "KB금융",           ratio:  2.12 },
  { ticker: "055550.KS", name: "신한지주",         ratio:  1.89 },
];

const FX_TICKERS = [
  { ticker: "KRW=X",    id: "USD/KRW", jpyScale: false },
  { ticker: "EURKRW=X", id: "EUR/KRW", jpyScale: false },
  { ticker: "JPYKRW=X", id: "JPY/KRW", jpyScale: true },
];

const OIL_TICKERS = [
  { ticker: "CL=F", id: "WTI",   name: "WTI 원유" },
  { ticker: "BZ=F", id: "BRENT", name: "브렌트유" },
];

// ─── 공통 헬퍼 ────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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
    return await res.json();
  } catch (_err) {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractQuote(json, jpyScale = false) {
  try {
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta;
    let price     = meta?.regularMarketPrice ?? null;
    let prevClose = meta?.chartPreviousClose ?? null;

    if (price === null || price === undefined) return null;

    if (jpyScale) {
      price     = price     !== null ? price * 100     : null;
      prevClose = prevClose !== null ? prevClose * 100 : null;
    }

    const change     = prevClose !== null ? price - prevClose : null;
    const changeRate = (change !== null && prevClose) ? (change / prevClose) * 100 : null;

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

function round(val, digits) {
  if (val === null || val === undefined) return null;
  return parseFloat(val.toFixed(digits));
}

function getMarketStatus() {
  const now = new Date();
  const kstMinutes = (now.getUTCHours() * 60 + now.getUTCMinutes() + 9 * 60) % (24 * 60);

  const OPEN_START = 9  * 60;
  const OPEN_END   = 15 * 60 + 30;
  const PRE_START  = 8  * 60;

  if (kstMinutes >= OPEN_START && kstMinutes < OPEN_END) return "OPEN";
  if (kstMinutes >= PRE_START  && kstMinutes < OPEN_START) return "PRE_MARKET";
  return "CLOSED";
}

// ─── 메인 핸들러 ─────────────────────────────────────────────────────────────

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    const allTickers = [
      ...INDEX_TICKERS.map((d) => ({ ...d, group: "index" })),
      ...STOCK_TICKERS.map((d) => ({ ...d, group: "stock" })),
      ...FX_TICKERS.map((d)    => ({ ...d, group: "fx"    })),
      ...OIL_TICKERS.map((d)   => ({ ...d, group: "oil"   })),
    ];

    const results = await Promise.allSettled(
      allTickers.map((item) => fetchYahooTicker(item.ticker))
    );

    const quoteMap = {};
    results.forEach((result, i) => {
      const item = allTickers[i];
      const json = result.status === "fulfilled" ? result.value : null;
      const isJpy = item.ticker === "JPYKRW=X";
      quoteMap[item.ticker] = extractQuote(json, isJpy);
    });

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

    const stocks = STOCK_TICKERS
      .map((def) => {
        const q = quoteMap[def.ticker];
        if (!q) return null;
        return {
          id:         def.ticker,
          name:       def.name,
          ratio:      def.ratio,
          price:      q.price,
          change:     q.change,
          changeRate: q.changeRate,
          volume:     q.volume,
        };
      })
      .filter(Boolean);

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
    console.error("[market.js] Unhandled error:", err);
    return new Response(
      JSON.stringify({ success: false, error: { code: "INTERNAL_ERROR", message: "시장 데이터 수집 중 오류가 발생했습니다." } }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
