// 아스키 8컷 만화 — Supabase Edge Function (이름: ascii-comic)
// Supabase 대시보드 > Edge Functions > Deploy a new function > Via Editor 에 붙여넣고 배포
// Gemini API 키는 summarize 와 같은 GEMINI_API_KEY (Edge Function Secrets, 프로젝트 전체 공용)
// 무료 등급은 보낸 내용이 Google 제품 개선에 쓰일 수 있음.

// 앞에서부터 시도. 그림 실력 때문에 Flash 를 먼저, 붐비면(429/503) 또는 종료됐으면(404) 다음 모델로
const GEMINI_MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite"];
const TRY_NEXT = [404, 429, 500, 503];

const PANELS = 8;
const MAX_COLS = 36;
const MAX_ROWS = 14;
const MAX_PLOT = 300;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

const SYSTEM_PROMPT = `한두 문장의 줄거리를 받아 ${PANELS}컷 만화를 만듭니다. 줄거리는 <plot> 안에 있습니다.
- 정확히 ${PANELS}컷. 처음, 전개, 반전, 마무리가 자연스럽게 이어지게.
- lines: 그 컷의 장면을 그린 아스키 아트. 배열의 원소 하나가 그림의 한 줄입니다.
  최대 ${MAX_ROWS}줄, 줄마다 최대 ${MAX_COLS}자. 한 줄 안에 줄바꿈 기호(\\n)를 넣지 마세요.
  영문 키보드의 문자(알파벳, 숫자, 기호, 공백)만 쓰세요. 한글, 이모지, 탭은 그림이 어긋나므로 금지.
  역슬래시(\\)는 그림에 필요한 만큼 한 번씩만 쓰세요.
  같은 인물은 매 컷 같은 모양으로 그려서 누가 누군지 알아볼 수 있게.
- caption: 그 컷의 대사나 설명. 한국어 한 문장.
- caption_en: caption 을 자연스러운 영어 한 문장으로 옮긴 자막 (인스타그램용).
- title: 한국어 짧은 제목.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    panels: {
      type: "ARRAY",
      minItems: PANELS,
      maxItems: PANELS,
      items: {
        type: "OBJECT",
        properties: {
          lines: { type: "ARRAY", items: { type: "STRING" } },
          caption: { type: "STRING" },
          caption_en: { type: "STRING" },
        },
        required: ["lines", "caption", "caption_en"],
      },
    },
  },
  required: ["title", "panels"],
};

function reply(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

// 부른 사람이 로그인한 사람인지 Supabase 에 확인 (로그인 정보가 없거나 가짜면 null)
async function currentUser(req: Request) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: req.headers.get("apikey") ?? "",
      Authorization: req.headers.get("Authorization") ?? "",
    },
  });
  return res.ok ? await res.json() : null;
}

async function askGemini(model: string, apiKey: string, plot: string) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: `<plot>${plot}</plot>` }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
      }),
    },
  );
  return { res, data: await res.json() };
}

// 폰 화면에서 어긋나지 않게: 영문 기호가 아닌 글자는 공백으로, 폭과 줄 수는 잘라냄
// 모델이 줄바꿈을 "\n" 글자로, 역슬래시를 "\\" 로 두 번 써서 보내는 경우도 바로잡음
function cleanArt(art: unknown) {
  let text = Array.isArray(art) ? art.map(String).join("\n") : String(art ?? "");
  text = text.replace(/\\n/g, "\n");
  const runs = text.match(/\\+/g) ?? [];
  if (runs.length && runs.every((run) => run.length % 2 === 0)) {
    text = text.replace(/\\+/g, (run) => run.slice(run.length / 2));
  }
  const lines = text
    .replace(/\t/g, "  ")
    .replace(/[^\x20-\x7E\n]/g, " ")
    .split("\n")
    .map((line) => line.slice(0, MAX_COLS).replace(/\s+$/, ""));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.slice(0, MAX_ROWS).join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return reply({ ok: true });

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return reply({ error: "GEMINI_API_KEY 미설정 (Edge Function Secrets)" }, 500);

  try {
    // 1. 로그인한 사람만 (무료 사용량을 모두가 같이 쓰므로)
    if (!(await currentUser(req))) return reply({ error: "로그인이 필요합니다." }, 401);

    // 2. 줄거리 확인
    const body = await req.json().catch(() => ({}));
    const plot = String(body.plot ?? "").trim();
    if (!plot) return reply({ error: "줄거리를 입력하세요." }, 400);
    if (plot.length > MAX_PLOT) return reply({ error: `줄거리는 ${MAX_PLOT}자 이내로 써주세요.` }, 400);

    // 3. Gemini 에게 8컷 요청 (붐비면 다음 모델로)
    let model = "", res: Response | undefined, data;
    for (model of GEMINI_MODELS) {
      ({ res, data } = await askGemini(model, apiKey, plot));
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

    // 4. 받은 JSON 을 꺼내서 다듬기
    const candidate = data.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .filter((part: { text?: string; thought?: boolean }) => part.text && !part.thought)
      .map((part: { text: string }) => part.text)
      .join("");
    let comic;
    try {
      comic = JSON.parse(text);
    } catch {
      return reply({ error: `만화를 읽지 못했습니다 (${candidate?.finishReason ?? "응답 없음"}). 다시 시도하세요.` }, 502);
    }
    const panels = (Array.isArray(comic.panels) ? comic.panels : [])
      .slice(0, PANELS)
      .map((p: { lines?: string[]; art?: string; caption?: string; caption_en?: string }) => ({
        art: cleanArt(p.lines ?? p.art ?? ""),
        caption: String(p.caption ?? "").trim().slice(0, 120),
        caption_en: String(p.caption_en ?? "").trim().slice(0, 200),
      }));
    if (panels.length < PANELS) {
      return reply({ error: `${panels.length}컷밖에 받지 못했습니다. 다시 시도하세요.` }, 502);
    }

    return reply({ title: String(comic.title ?? "").trim().slice(0, 40), panels, model });
  } catch (e) {
    console.error(e);
    return reply({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
