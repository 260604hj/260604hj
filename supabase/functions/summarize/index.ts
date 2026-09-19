// 관리자 메모 요약 — Supabase Edge Function (이름: summarize)
// Supabase 대시보드 > Edge Functions > Deploy a new function > Via Editor 에 붙여넣고 배포
// Gemini API 키는 대시보드 > Edge Function Secrets 의 GEMINI_API_KEY 에만 둔다. 코드나 저장소에 넣지 말 것.
// 무료 등급은 보낸 내용이 Google 제품 개선에 쓰일 수 있음.

// 앞에서부터 시도. 모델마다 Google 서버 자원이 따로라, 하나가 붐비면(429/503) 또는 종료됐으면(404) 다음 모델로
const GEMINI_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite"];
const TRY_NEXT = [404, 429, 500, 503];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

const SYSTEM_PROMPT = `관리자가 남긴 메모 목록을 요약합니다. 메모는 <memos> 안에 "[작성 시각] 내용" 형식으로 있습니다.
한국어로 핵심만 짧게 정리하세요. 화면에 글자 그대로 표시되므로 마크다운 기호 없이, 전체적 추세를 요약하는 두세문장으로 쓰세요.
메모에 없는 내용은 추측해서 덧붙이지 마세요.`;

function reply(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

// 부른 사람의 로그인 정보를 그대로 들고 Supabase 창구에 요청 → RLS 규칙이 그 사람 기준으로 적용됨
// body 가 있으면 저장(insert), 없으면 읽기(select)
async function asCaller(req: Request, path: string, body?: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      apikey: req.headers.get("apikey") ?? "",
      Authorization: req.headers.get("Authorization") ?? "",
      ...(body ? { "Content-Type": "application/json", Prefer: "return=representation" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function askGemini(model: string, apiKey: string, text: string) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text }] }],
      }),
    },
  );
  return { res, data: await res.json() };
}

function kst(iso: string) {
  return new Date(iso).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return reply({ ok: true });

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return reply({ error: "GEMINI_API_KEY 미설정 (Edge Function Secrets)" }, 500);

  try {
    // 1. 관리자인가? admins 는 본인 줄만 보이는 규칙이라, 한 줄이라도 보이면 관리자
    const me = await asCaller(req, "admins?select=user_id&limit=1");
    if (me.length === 0) return reply({ error: "권한 없음" }, 403);

    // 2. 메모 읽기
    const memos: { content: string; created_at: string }[] = await asCaller(
      req,
      "admin_memos?select=content,created_at&order=created_at.asc",
    );
    if (memos.length === 0) return reply({ error: "요약할 메모가 없습니다." }, 400);

    // 3. Gemini 에게 요약 요청 (붐비면 다음 모델로)
    const list = memos.map((m) => `[${kst(m.created_at)}] ${m.content}`).join("\n");
    let model = "", res: Response | undefined, data;
    for (model of GEMINI_MODELS) {
      ({ res, data } = await askGemini(model, apiKey, `<memos>\n${list}\n</memos>`));
      if (res.ok || !TRY_NEXT.includes(res.status)) break;
      console.warn(`${model} ${res.status}: ${data.error?.message ?? ""}`);
    }

    if (!res!.ok) {
      const detail = `${res!.status}: ${data.error?.message ?? ""}`;
      if (TRY_NEXT.includes(res!.status)) {
        return reply({ error: `Gemini 모델 ${GEMINI_MODELS.length}개가 모두 응답하지 못했습니다. 잠시 후 다시 시도하세요. (${detail})` }, 503);
      }
      return reply({ error: `Gemini 오류 ${detail}` }, 502);
    }
    if (data.promptFeedback?.blockReason) {
      return reply({ error: `Gemini 가 요청을 차단했습니다 (${data.promptFeedback.blockReason})` }, 422);
    }

    const candidate = data.candidates?.[0];
    const summary = (candidate?.content?.parts ?? [])
      .filter((part: { text?: string; thought?: boolean }) => part.text && !part.thought)
      .map((part: { text: string }) => part.text)
      .join("")
      .trim();
    if (!summary) {
      return reply({ error: `요약을 받지 못했습니다 (${candidate?.finishReason ?? "응답 없음"})` }, 502);
    }
    // 4. 요약 저장 → 화면 맨 위에 누구나 볼 수 있게
    const [saved] = await asCaller(req, "memo_summaries?select=content,model,created_at", {
      content: summary,
      model,
    });
    return reply(saved);
  } catch (e) {
    console.error(e);
    return reply({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
