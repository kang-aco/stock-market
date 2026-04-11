/**
 * briefing.js — Cloudflare Pages Function
 * 미국 주식시장 마감 브리핑을 Claude API(web_search 포함)로 생성해 반환합니다.
 *
 * GET  /api/briefing  → { report, generatedAt }
 * OPTIONS /api/briefing → CORS preflight
 */

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

  const apiKey = context.env.ANTHROPIC_API_KEY;

  try {
    const now = new Date();
    const dateStr = now.toLocaleDateString("ko-KR", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "interleaved-thinking-2025-05-14",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{
          role: "user",
          content:
            `오늘은 ${dateStr}입니다. 오늘 날짜 기준 전날(미국 현지 시간) 미국 주식시장 마감 현황을 web_search로 검색해서 다음 구조의 한국어 분석 보고서를 작성해줘:\n\n` +
            "제목: [날짜] 미국 시장 마감 브리핑\n" +
            "1. 주요 지수 요약 (다우/S&P500/나스닥/SOX 등락률 + 한 줄 해석)\n" +
            "2. 핵심 재료 분석 (시장 움직인 주요 뉴스 3개 + 한국 시장 영향 경로)\n" +
            "3. 반도체 섹터 분석 (NVIDIA/AMD/마이크론/TSMC ADR + 코스피 반도체 연동 전망)\n" +
            "4. 환율 및 유동성 (DXY/미국10년물금리/VIX + 원달러 환율 방향)\n" +
            "5. 내일 주목할 일정 (경제지표/연준 발언/실적 발표)\n\n" +
            "분량: 600~900자, 투자 권유 아님 명시",
        }],
      }),
    });

    if (!claudeResponse.ok) {
      const errBody = await claudeResponse.text();
      console.error("Claude API error:", claudeResponse.status, errBody);
      throw new Error(`Claude API responded with status ${claudeResponse.status}`);
    }

    const claudeData = await claudeResponse.json();

    const reportText = (claudeData.content || [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    return new Response(
      JSON.stringify({ report: reportText, generatedAt: new Date().toISOString() }),
      { headers: corsHeaders }
    );
  } catch (err) {
    console.error("briefing function error:", err);
    return new Response(
      JSON.stringify({ error: "보고서 생성 실패", report: "미국 시장 데이터를 불러올 수 없습니다.", generatedAt: new Date().toISOString() }),
      { status: 500, headers: corsHeaders }
    );
  }
}
