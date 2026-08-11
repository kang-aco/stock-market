/**
 * Cloudflare Pages Function — /api/market
 *
 * - 지수(한국·미국·아시아·유럽)/환율/원자재: Yahoo Finance (공개 API)
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

// region: 프런트엔드 지역 탭 필터용 (korea | us | asia | eu)
const INDEX_TICKERS = [
  // 한국
  { ticker: "^KS11",     id: "KOSPI",      name: "코스피",           region: "korea", optional: false },
  { ticker: "^KQ11",     id: "KOSDAQ",     name: "코스닥",           region: "korea", optional: false },
  { ticker: "^KS200",    id: "KOSPI200F",  name: "코스피200",        region: "korea", optional: false },
  { ticker: "^KQ150",    id: "KOSDAQ150F", name: "코스닥150선물",    region: "korea", optional: true  },
  // 미국
  { ticker: "^DJI",      id: "DOW",        name: "다우존스",         region: "us",    optional: false },
  { ticker: "^IXIC",     id: "NASDAQ",     name: "나스닥",           region: "us",    optional: false },
  { ticker: "^GSPC",     id: "SP500",      name: "S&P 500",          region: "us",    optional: false },
  { ticker: "^SOX",      id: "SOX",        name: "필라델피아반도체", region: "us",    optional: false },
  // 아시아
  { ticker: "^N225",     id: "N225",       name: "니케이 225",       region: "asia",  optional: true  },
  { ticker: "000001.SS", id: "SSEC",       name: "상하이종합",       region: "asia",  optional: true  },
  { ticker: "^HSI",      id: "HSI",        name: "항셍지수",         region: "asia",  optional: true  },
  // 유럽
  { ticker: "^STOXX50E", id: "SX5E",       name: "유로스톡스50",     region: "eu",    optional: true  },
  { ticker: "^FTSE",     id: "UKX",        name: "FTSE 100",         region: "eu",    optional: true  },
  { ticker: "^GDAXI",    id: "DAX",        name: "DAX",              region: "eu",    optional: true  },
];

// NH아문디 필승코리아 증권투자신탁[주식] 편입 상위 5개 종목.
// weight = 펀드 내 비중(%), 운용사 공시값이며 FUND_WEIGHT_AS_OF 기준입니다.
// 펀드 보유내역은 실시간 공시 대상이 아니므로 비중은 시세와 달리 갱신되지 않습니다.
// 출처: https://www.nh-amundi.com/fund/C96F2EB7DB974F97 (주요 보유 종목 TOP5)
// kisCode: KIS API용 종목코드 (6자리), ticker: Yahoo Finance 폴백용
const FUND_WEIGHT_AS_OF = "2026-07-10";

const STOCK_TICKERS = [
  { ticker: "005930.KS", kisCode: "005930", name: "삼성전자",                 weight: 30.74 },
  { ticker: "000660.KS", kisCode: "000660", name: "SK하이닉스",               weight: 25.70 },
  { ticker: "402340.KS", kisCode: "402340", name: "SK스퀘어",                 weight: 5.58  },
  { ticker: "009150.KS", kisCode: "009150", name: "삼성전기",                 weight: 3.90  },
  // 2026년 4월 LIG넥스원에서 사명 변경 (종목코드 079550은 그대로)
  { ticker: "079550.KS", kisCode: "079550", name: "LIG디펜스앤에어로스페이스", weight: 2.05  },
];

const FX_TICKERS = [
  { ticker: "KRW=X",    id: "USD/KRW", jpyScale: false },
  { ticker: "EURKRW=X", id: "EUR/KRW", jpyScale: false },
  // JPY/KRW: Yahoo Finance가 1엔 기준으로 반환하므로 ×100 적용
  { ticker: "JPYKRW=X", id: "JPY/KRW", jpyScale: true },
];

// 원자재·가상자산 — unit은 카드에 표시할 통화/단위 표기
const COMMODITY_TICKERS = [
  { ticker: "CL=F",    id: "WTI",   name: "WTI 원유",  unit: "USD" },
  { ticker: "BZ=F",    id: "BRENT", name: "브렌트유",  unit: "USD" },
  { ticker: "GC=F",    id: "GOLD",  name: "금",        unit: "USD" },
  { ticker: "BTC-USD", id: "BTC",   name: "비트코인",  unit: "USD" },
];

// ─── KIS API 헬퍼 ─────────────────────────────────────────────────────────────

// 모듈 레벨 토큰 캐시 — CF Worker 인스턴스 수명 동안 재사용해 토큰 발급 빈도를 줄임
let _kisToken = null;
let _kisTokenExpiry = 0;

/**
 * KIS OAuth2 액세스 토큰을 반환합니다.
 * 유효한 캐시가 있으면 재사용하고, 만료 1시간 전부터 미리 갱신합니다.
 * KIS 토큰 유효기간은 약 24시간이므로 23시간으로 캐시합니다.
 */
async function getKisAccessToken(appKey, appSecret) {
  const now = Date.now();
  if (_kisToken && now < _kisTokenExpiry) return _kisToken;

  const res = await fetch(`${KIS_BASE_URL}/oauth2/tokenP`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", appkey: appKey, appsecret: appSecret }),
  });
  if (!res.ok) throw new Error(`KIS 토큰 발급 실패: HTTP ${res.status}`);
  const json = await res.json();
  if (!json.access_token) throw new Error("KIS 토큰 응답에 access_token 없음");

  _kisToken = json.access_token;
  // expires_in(초) 필드가 있으면 활용, 없으면 23시간 기본값
  const expiresIn = json.expires_in ? (json.expires_in - 3600) * 1000 : 23 * 60 * 60 * 1000;
  _kisTokenExpiry = now + expiresIn;
  return _kisToken;
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
    // = 는 선물(CL=F, BZ=F)·환율(KRW=X) 티커에 사용되므로 인코딩하지 않음
    // 일봉 10일치: 전일 종가를 일봉에서 직접 확정하기 위함 (extractQuote 주석 참고)
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker).replace(/%3D/gi, '=')}?interval=1d&range=10d`;
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
 * 전일 종가는 meta 값을 쓰지 않고 일봉에서 직접 확정합니다. 이유:
 *  1. meta.regularMarketChange / regularMarketChangePercent 는 Yahoo가 더 이상
 *     내려주지 않습니다(항상 undefined). 이 값에 의존하던 경로는 죽은 코드였습니다.
 *  2. 폴백이던 meta.previousClose / chartPreviousClose 는 일부 티커에서 한 거래일
 *     낡은 값이 옵니다. 실제로 ^KQ11(코스닥)·000001.SS(상하이)가 직전 거래일을
 *     건너뛴 종가를 반환해 등락률 부호까지 뒤집혔습니다.
 * 따라서 '현재 거래일보다 앞선 마지막 일봉 종가'를 전일 종가로 사용합니다.
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

    // 거래소 현지 기준 날짜로 봉을 구분한다 (UTC로 자르면 아시아장이 밀림)
    const dayFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: meta?.exchangeTimezoneName || "UTC",
      year: "numeric", month: "2-digit", day: "2-digit",
    });
    const sessionDate = (epochSec) => dayFormatter.format(new Date(epochSec * 1000));

    const stamps = result.timestamp ?? [];
    const closes = result.indicators?.quote?.[0]?.close ?? [];

    const bars = [];
    for (let i = 0; i < stamps.length; i++) {
      const c = closes[i];
      if (c === null || c === undefined) continue;
      bars.push({ date: sessionDate(stamps[i]), close: c });
    }

    let price = meta?.regularMarketPrice ?? bars[bars.length - 1]?.close ?? null;
    if (price === null || price === undefined) return null;

    // 현재 거래일 — 장중이면 오늘, 장 마감 후면 마지막으로 체결된 거래일
    const currentDate = meta?.regularMarketTime
      ? sessionDate(meta.regularMarketTime)
      : bars[bars.length - 1]?.date;

    // 전일 종가 = 현재 거래일보다 앞선 마지막 일봉
    let prevClose = null;
    for (let i = bars.length - 1; i >= 0; i--) {
      if (bars[i].date < currentDate) { prevClose = bars[i].close; break; }
    }
    // 일봉이 부족한 티커(^KS200 등)는 meta 값으로 폴백
    if (prevClose === null) {
      prevClose = meta?.chartPreviousClose ?? meta?.previousClose ?? null;
    }

    // sparkline: 최근 10거래일 종가 추세
    let sparkline = bars.map((b) => b.close).slice(-10);

    // JPY/KRW는 1엔 기준이므로 100엔 기준으로 환산
    if (jpyScale) {
      price     = price * 100;
      prevClose = prevClose !== null ? prevClose * 100 : null;
      sparkline = sparkline.map((v) => v * 100);
    }

    const change     = prevClose !== null ? price - prevClose : null;
    const changeRate = (change !== null && prevClose) ? (change / prevClose) * 100 : null;

    return {
      price:      round(price, 2),
      prevClose:  round(prevClose, 2),
      change:     round(change, 2),
      changeRate: round(changeRate, 2),
      sparkline,
      volume:     meta?.regularMarketVolume ?? null,
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
      return { id: def.ticker, code: def.kisCode, name: def.name, weight: def.weight, price: q.price, change: q.change, changeRate: q.changeRate, volume: q.volume };
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
      ...INDEX_TICKERS.map((d)     => ({ ...d, group: "index"     })),
      ...FX_TICKERS.map((d)        => ({ ...d, group: "fx"        })),
      ...COMMODITY_TICKERS.map((d) => ({ ...d, group: "commodity" })),
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
    // optional 지수는 시세 조회에 실패하면 카드 자체를 내보내지 않습니다.
    // (필수 지수는 N/A 상태로라도 노출해 데이터 누락을 드러냅니다.)
    const indices = INDEX_TICKERS
      .map((def) => {
        const q = quoteMap[def.ticker];
        if (!q && def.optional) return null;
        return {
          id:         def.id,
          name:       def.name,
          region:     def.region,
          value:      q?.price      ?? null,
          change:     q?.change     ?? null,
          changeRate: q?.changeRate ?? null,
          sparkline:  q?.sparkline  ?? [],
        };
      })
      .filter(Boolean);

    // ── stocks: KIS API 우선, 미설정 시 Yahoo Finance 폴백 ───────────────────
    let stocks;
    if (appKey && appSecret) {
      try {
        const accessToken = await getKisAccessToken(appKey, appSecret);
        const kisResults = await Promise.allSettled(
          STOCK_TICKERS.map((def) => fetchKisStockQuote(accessToken, appKey, appSecret, def.kisCode))
        );
        stocks = STOCK_TICKERS
          .map((def, i) => {
            const q = kisResults[i].status === "fulfilled" ? kisResults[i].value : null;
            if (!q) return null;
            return { id: def.ticker, code: def.kisCode, name: def.name, weight: def.weight, price: q.price, change: q.change, changeRate: q.changeRate, volume: q.volume };
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

    // ── commodities (유가·금·비트코인) ────────────────────────────────────────
    const commodities = COMMODITY_TICKERS
      .map((def) => {
        const q = quoteMap[def.ticker];
        if (!q) return null;
        return {
          id:         def.id,
          name:       def.name,
          unit:       def.unit,
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
      commodities,
      // 펀드 비중 공시 기준일 — 시세(updatedAt)와 갱신 주기가 다름을 화면에 알리기 위함
      fundAsOf:     FUND_WEIGHT_AS_OF,
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
