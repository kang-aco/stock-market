/**
 * briefing.js — Cloudflare Pages Function
 *
 * 미국 시장 마감 브리핑 생성 (Claude Sonnet + web_search)
 * 최적화:
 *   - interleaved-thinking 제거 (비용/속도 최대 절감)
 *   - max_tokens 3000 → 1500
 *   - 프롬프트 압축
 *   - 1시간 엣지 캐싱 적용
 *
 * GET  /api/briefing  → { report, generatedAt }
 * OPTIONS             → CORS preflight
 */

const CACHE_TTL = 3600; // 1시간

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // ── 캐시 확인 ─────────────────────────────────────────────────────────────
  const cacheReq = new Request(context.request.url, { method: "GET" });
  try {
    const cached = await caches.default.match(cacheReq);
    if (cached) return cached;
  } catch (_) {}

  const apiKey = context.env.ANTHROPIC_API_KEY;

  const now = new Date();
  const nyDateStr = now.toLocaleDateString("ko-KR", {
    timeZone: "America/New_York",
    year: "numeric", month: "long", day: "numeric",
  });
  const nyTimeStr = now.toLocaleTimeString("ko-KR", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit",
  });

  const SYSTEM_PROMPT = `KOSPI/KOSDAQ 20년 경력 전문 트레이더. 글로벌 매크로+수급 분석 전문.
각 지표: 수치+해석+KOSPI영향 형식으로 명확하고 단호하게 작성. 모호한 표현 금지.`;

  const USER_PROMPT =
`뉴욕 현지시각: ${nyDateStr} ${nyTimeStr}
web_search로 최신 미국 시장 마감 데이터를 검색해 아래 형식으로 브리핑 작성:

🌎 미국 시장 마감 브리핑 [${nyDateStr}]

① SOX: 종가/등락% → 해석 → KOSPI 반도체 영향 (NVIDIA/AMD/Micron 포함)
② S&P500/NASDAQ100: 수치/등락% → 심리 → KOSPI 갭 방향
③ USD/KRW: 수치/변화 → 외국인 수급 영향
④ 미10년물금리: 수치/bp변화 → 성장주 압박
⑤ VIX: 수치/변화 → 내일 변동성

📰 핵심 트리거 3선 (한국 전달 경로 포함)
⏰ 내일 주목 일정
🎯 글로벌→KOSPI 한줄 요약

※투자 권유 아님`;

  try {
    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        // interleaved-thinking 제거 — 추론 토큰 과금 방지
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{ role: "user", content: USER_PROMPT }],
      }),
    });

    if (!claudeResponse.ok) {
      const errBody = await claudeResponse.text();
      console.error("[briefing] Claude API error:", claudeResponse.status, errBody);
      throw new Error(`Claude API status ${claudeResponse.status}`);
    }

    const claudeData = await claudeResponse.json();
    const reportText = (claudeData.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const data = { report: reportText, generatedAt: new Date().toISOString() };
    const response = new Response(JSON.stringify(data), {
      headers: {
        ...corsHeaders,
        "Cache-Control": `public, max-age=${CACHE_TTL}`,
      },
    });

    // ── 캐시 저장 ───────────────────────────────────────────────────────────
    try {
      await caches.default.put(cacheReq, response.clone());
    } catch (_) {}

    return response;

  } catch (err) {
    console.error("[briefing] error:", err);
    return new Response(
      JSON.stringify({
        error: "브리핑 생성 실패",
        report: "미국 시장 데이터를 불러올 수 없습니다.",
        generatedAt: new Date().toISOString(),
      }),
      { status: 500, headers: corsHeaders }
    );
  }
}
