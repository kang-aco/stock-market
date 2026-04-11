/**
 * prediction.js — Cloudflare Pages Function
 *
 * /api/briefing 에서 미국 시장 보고서를 수신한 뒤,
 * Claude API(claude-sonnet-4-20250514)를 이용해
 * 한국 주식시장(코스피·코스닥) 예측 보고서를 생성하여 반환합니다.
 *
 * 환경변수:
 *   ANTHROPIC_API_KEY — Anthropic API 인증 키 (context.env 를 통해서만 참조)
 */

export async function onRequest(context) {
  const corsHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (context.request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let report = "";
  try {
    const briefingUrl = new URL("/api/briefing", context.request.url).toString();
    const briefingRes = await fetch(briefingUrl);

    if (!briefingRes.ok) throw new Error(`briefing HTTP ${briefingRes.status}`);

    const briefingData = await briefingRes.json();
    report = briefingData.report || "";
  } catch (err) {
    console.error("[prediction] /api/briefing 호출 실패:", err);
    report = "미국 시장 데이터를 불러올 수 없습니다. 일반적인 시장 구조 분석을 제공합니다.";
  }

  const apiKey = context.env.ANTHROPIC_API_KEY;

  try {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2500,
        messages: [{
          role: "user",
          content:
            `다음 미국 시장 분석 보고서를 바탕으로 오늘 한국 주식시장 예측 보고서를 작성해줘:\n\n` +
            `[미국 시장 보고서]\n${report}\n\n` +
            `예측 보고서 구조:\n` +
            `제목: 오늘 코스피·코스닥 시장 전망\n` +
            `1. 시장 방향성\n` +
            `   - 코스피 예상 범위 (숫자로 명시: 예 2,620 ~ 2,680)\n` +
            `   - 상승/하락 확률 (합계 반드시 100%: 예 상승 65% / 하락 35%)\n` +
            `   - 장 구조 예측: 전강후약 / 전약후강 / 종일상승 / 종일하락 / 박스권 중 하나 선택 + 이유\n` +
            `2. 핵심 근거 (미국 시장 → 한국 시장 영향 경로 3개)\n` +
            `3. 투자자별 수급 예측 (외국인/기관/개인 방향)\n` +
            `4. 주목 업종 TOP3 (업종명 + 상승 근거 한 줄)\n` +
            `5. 리스크 패턴 경보 (외국인 선물 트랩·개미털기 등 가능성 + 대응법)\n` +
            `6. 핵심 관찰 시간대 (09:30 / 10:30 / 13:30 / 14:30 확인 시그널)\n` +
            `7. 한 줄 결론: "[드라이버] + [보조요인] → [대응전략]" 형식\n\n` +
            `하단에 "본 보고서는 투자 권유가 아닌 시장 구조 분석입니다" 명시\n` +
            `분량: 800~1,000자`,
        }],
      }),
    });

    if (!claudeRes.ok) {
      const errBody = await claudeRes.text();
      throw new Error(`Claude API HTTP ${claudeRes.status}: ${errBody}`);
    }

    const claudeData = await claudeRes.json();

    let prediction = "";
    if (Array.isArray(claudeData.content)) {
      prediction = claudeData.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
    }

    return new Response(
      JSON.stringify({ prediction, generatedAt: new Date().toISOString() }),
      { status: 200, headers: corsHeaders }
    );

  } catch (err) {
    console.error("[prediction] Claude API 호출 실패:", err);
    return new Response(
      JSON.stringify({ error: "예측 보고서 생성 실패", prediction: "예측 보고서를 생성할 수 없습니다.", generatedAt: new Date().toISOString() }),
      { status: 500, headers: corsHeaders }
    );
  }
}
