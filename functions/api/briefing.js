/**
 * briefing.js — Cloudflare Pages Function
 *
 * 전문 트레이더 관점의 미국 시장 마감 브리핑을 생성합니다.
 * 1순위 지표(SOX·S&P500선물·USD/KRW·10년물금리·VIX) 중심으로
 * "숫자 + 해석 + KOSPI 영향" 형식으로 출력합니다.
 *
 * GET  /api/briefing  → { report, generatedAt }
 * OPTIONS             → CORS preflight
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
    const nyDateStr = now.toLocaleDateString("ko-KR", {
      timeZone: "America/New_York",
      year: "numeric", month: "long", day: "numeric",
    });
    const nyTimeStr = now.toLocaleTimeString("ko-KR", {
      timeZone: "America/New_York",
      hour: "2-digit", minute: "2-digit",
    });

    const SYSTEM_PROMPT = `당신은 국내 주식시장(KOSPI/KOSDAQ)에서 20년 이상 활동한 전문 트레이더입니다.
글로벌 매크로(거시경제) + 수급(자금흐름) + 기술적 분석을 통합해 시황을 분석합니다.
데이터 기반으로 분석하며, "아마도" "~것 같다" 같은 모호한 표현 대신 명확하고 단호한 표현을 사용합니다.
각 지표는 반드시 "수치 + 해석 + KOSPI 영향"을 함께 제시합니다.`;

    const USER_PROMPT =
`현재 뉴욕 현지 시각은 ${nyDateStr} ${nyTimeStr}입니다.
web_search로 가장 최신 미국 시장 마감 데이터를 검색하여 아래 형식의 브리핑을 작성해주세요.

━━━━━━━━━━━━━━━━━━━━━━━━━
🌎 [날짜] 미국 시장 마감 브리핑
━━━━━━━━━━━━━━━━━━━━━━━━━

🇺🇸 【1순위 지표 — 반드시 수치 포함】

① 필라델피아 반도체지수(SOX)
   - 종가: X,XXX.XX  등락: ±X.XX%
   → 해석 (AI 모멘텀 / 재고 우려 등)
   → KOSPI 반도체 연동 전망 (삼성전자·SK하이닉스 방향)
   ※ NVIDIA / AMD / Micron / Broadcom 개별 등락 포함

② S&P 500 / NASDAQ 100
   - S&P 500: X,XXX.XX (±X.XX%)
   - NASDAQ 100: XX,XXX.XX (±X.XX%)
   → 시장 심리 해석
   → KOSPI 갭 방향 예측

③ USD/KRW 환율
   - 현재: X,XXX.XX원  전일 대비: ±X원
   → 외국인 수급 영향 진단
     (환율 +10원↑ = 외국인 매도 가능성 / -5원↓ = 유입 우호)

④ 미국 10년물 국채금리
   - 현재: X.XX%  전일 대비: ±X.XXbp
   → 성장주·기술주 밸류에이션 영향
   → 코스피 기술·반도체 섹터 압박 여부

⑤ VIX 공포지수
   - 현재: XX.XX  전일 대비: ±X.XX
   → 시장 불안 수준 (25 이상 = 추세 매매 신뢰 하락)
   → 내일 KOSPI 변동성 예고

📰 【핵심 트리거 3선 — 한국 전달 경로 명시】

1️⃣ [이벤트명]
   → 직접 영향 경로
   → 연동 섹터/종목

2️⃣ [이벤트명]
   → 직접 영향 경로
   → 연동 섹터/종목

3️⃣ [이벤트명]
   → 직접 영향 경로
   → 연동 섹터/종목

⏰ 【내일 주목 일정】
- 경제지표: (CPI / 고용 / FOMC 등)
- 연준 발언 예정
- 주요 실적 발표

🎯 【글로벌 → KOSPI 한줄 요약】
"[핵심 드라이버] + [보조 요인] → [내일 KOSPI 방향성 한 줄]"

※ 본 분석은 시장 구조 분석이며 투자 권유가 아닙니다.`;

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
        max_tokens: 3000,
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

    return new Response(
      JSON.stringify({ report: reportText, generatedAt: new Date().toISOString() }),
      { headers: corsHeaders }
    );

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
