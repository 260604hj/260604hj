// 오마카세 — Supabase Edge Function (이름: omacase)
// Supabase 대시보드 > Edge Functions > Deploy a new function > Via Editor 에 붙여넣고 배포
// Gemini API 키는 다른 함수와 같은 GEMINI_API_KEY (Edge Function Secrets, 프로젝트 전체 공용)
// 이 함수만 로그인 없이 누구나 부를 수 있습니다 (Visitor 용). Verify JWT 를 꺼 두세요.
//
// 모델은 좌표도 덩어리도 만들지 않습니다. 세 가지만 차례로 정합니다.
//   ① 형상  음료·국물·알갱이·면·덩어리 중 무엇인가
//   ② 그릇  그 형상은 무슨 그릇에 담기는가
//   ③ 층    바닥부터 위로, 무엇을 몇 개씩 어떻게 놓는가
// 실제 모양·좌표·쌓이는 높이는 브라우저(omacase.html)가 계산합니다.
// 층과 조각 크기는 miniapps/ref/foodspace.3dm (실제 음식 모델링)의 구성을 따릅니다:
// 접시 19~30cm, 한 조각 1~3cm 짜리 수십 개, 고명 0.3~1cm, 바닥부터 3~4층.

const GEMINI_MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite"];
const TRY_NEXT = [404, 429, 500, 503];

const MAX_ORDER = 60;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MATTERS = ["drink", "soup", "grain", "noodle", "object"];
const VESSELS = ["flat_plate", "rimmed_plate", "bowl", "deep_bowl", "stone_pot", "board", "basket", "glass"];
const ROLES = ["base", "body", "top", "accent"];
const FORMS = [
  "disc", "sheet", "slab", "wedge", "round", "dome", "rod", "ring",
  "cone", "nest", "cube", "nigiri", "roll", "leaf", "grains", "crumb",
];
const PATTERNS = ["fill", "ring", "grid", "row", "fan", "scatter", "mound", "stack", "submerged"];

const SYSTEM_PROMPT = `You are a food stylist for a miniature 3D restaurant. You never draw and you never
give coordinates. You decide, in this order: what state the food is in, what it is served in, and what
layers it is built from, bottom first. The renderer owns every shape, position and height.

STEP 1 — matter
drink (마시는 액체), soup (국물 있는 음식), grain (밥·간 얼음처럼 알갱이가 모인 것),
noodle (면), object (빵·초밥·고기처럼 덩어리로 집어 먹는 것).
matter_why: one short Korean sentence, naming the dish's real form.

STEP 2 — vessel, which follows from matter
drink → glass. soup, noodle → deep_bowl (bowl when served wide, stone_pot when it bubbles).
grain → bowl, stone_pot, rimmed_plate. object → flat_plate, board, basket.
flat_plate 평접시, rimmed_plate 테두리 접시, bowl 사발, deep_bowl 깊은 면기,
stone_pot 돌솥, board 나무 도마, basket 바구니, glass 유리잔.
vessel_why: one short Korean sentence, naming what this dish is really served in.
size: the width across in cm — 18-22 small, 22-28 a main plate or bowl, 10-14 a glass.
color: the vessel's own colour. liquid: broth or sauce lying in it (colour + level 0-1), or null when dry.

STEP 3 — layers, from the bottom up
A real plate is not five big lumps. It is one broad base, then a few sizeable pieces, then many small
ones, then a sprinkle. Build it that way: 2 to 5 layers, always bottom first.
- role: base (바닥을 채우는 것: 도우·밥·면·크림·빵), body (그 위의 큰 조각: 슬라이스·고기·만두),
  top (작은 조각 여럿: 토핑·나물·과일), accent (뿌리는 것: 깨·허브·후추·초콜릿).
- form, the shape of ONE piece:
  disc 납작한 원판(도우·크래커·전), sheet 얇고 넓은 조각(치즈·김·햄), slab 도톰한 사각(빵·케이크·두부),
  wedge 삼각 조각(피자 한 쪽·레몬), round 공(완자·과일), dome 반구(스쿱·만두),
  rod 길쭉한 것(소시지·새우·감자), ring 고리(오징어링·양파), cone 뿔 모양 더미,
  nest 면 뭉치, cube 깍둑 썬 것, nigiri 초밥 한 점, roll 김밥·마키 한 조각, leaf 잎(바질·상추),
  grains 알갱이 무리(밥알·간 얼음 — 렌더러가 수백 알로 그림), crumb 부스러기·가루.
- size: the width of ONE piece in cm. base 16-28. body 3-7. top 1.5-3.5. accent 0.4-1.
- count: how many pieces. base 1 (grains is always 1). body 3-10. top 8-24. accent 20-60.
  A 24cm plate of pasta is ~60 pieces of 1.6cm, never 5 pieces of 5cm. Small and many.
- pattern: fill (바닥 전체를 덮음 — base 는 거의 언제나 이것), ring, grid, row, fan,
  scatter (흩뿌리기), mound (수북이), stack (위로 포개기), submerged (국물에 잠기게).
- color, and top_color for what lies on that piece (생선·소스·치즈). name: short Korean.
The person eats one piece at a time from the body and top layers, so those are the mouthfuls.

COLOURS — this kitchen's palette. Every channel is a multiple of 18; stay near these:
#FCFCEA #FCFCD8 #FCEAC6 #EAD8C6 #D8C690 #D8B490 #D8B47E #D8B46C #EAB45A #EAB448 #EAC648 #FCD86C
#EA9036 #C69036 #D8905A #FC907E #D89090 #C64836 #C63624 #B45A36 #B47E48 #7E5A36 #5A3624 #242424
#7E9036 #5A9036 #6C9048 #489048 #367E36 #90486C

REMEMBER THE REAL DISH
Picture it as it is actually served in its own country, then build that. Never substitute another dish.
Pizza: a disc base, wedges or sheets of cheese, many small round toppings, a sprinkle of leaf.
Bibimbap: a grains base of rice, a ring of small piles, one round egg, a sprinkle of crumb.
Ramen: liquid in a deep bowl, a nest base, a few slab slices of pork, small tops, leaf accents.
Bingsu: a grains base of ice, small round fruit on top, a sprinkle.
If the order is vague, pick one specific real dish and name it in dish. If it is not food, build the
closest edible thing.

OUTPUT — this exact JSON object, nothing else, no code fence
{"dish":"마르게리타 피자","matter":"object","matter_why":"손으로 집는 납작한 덩어리 음식이다.",
"serving":{"vessel":"board","vessel_why":"피자는 나무 도마에 통째로 올려 낸다.","size":26,
"color":"#B47E48","liquid":null},
"layers":[
{"role":"base","name":"도우","form":"disc","color":"#EAB45A","size":24,"count":1,"pattern":"fill"},
{"role":"body","name":"치즈","form":"sheet","color":"#FCFCD8","size":5,"count":8,"pattern":"scatter"},
{"role":"top","name":"방울토마토","form":"round","color":"#C63624","size":2.2,"count":14,"pattern":"scatter"},
{"role":"accent","name":"바질","form":"leaf","color":"#5A9036","size":0.9,"count":24,"pattern":"scatter"}]}`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    dish: { type: "STRING" },
    matter: { type: "STRING", enum: MATTERS },
    matter_why: { type: "STRING" },
    serving: {
      type: "OBJECT",
      properties: {
        vessel: { type: "STRING", enum: VESSELS },
        vessel_why: { type: "STRING" },
        size: { type: "NUMBER" },
        color: { type: "STRING" },
        liquid: {
          type: "OBJECT",
          nullable: true,
          properties: {
            color: { type: "STRING" },
            level: { type: "NUMBER" },
          },
          required: ["color", "level"],
          propertyOrdering: ["color", "level"],
        },
      },
      required: ["vessel", "vessel_why", "size", "color"],
      propertyOrdering: ["vessel", "vessel_why", "size", "color", "liquid"],
    },
    layers: {
      type: "ARRAY",
      minItems: 2,
      maxItems: 5,
      items: {
        type: "OBJECT",
        properties: {
          role: { type: "STRING", enum: ROLES },
          name: { type: "STRING" },
          form: { type: "STRING", enum: FORMS },
          color: { type: "STRING" },
          top_color: { type: "STRING" },
          size: { type: "NUMBER" },
          count: { type: "INTEGER" },
          pattern: { type: "STRING", enum: PATTERNS },
        },
        required: ["role", "name", "form", "color", "size", "count", "pattern"],
        propertyOrdering: ["role", "name", "form", "color", "top_color", "size", "count", "pattern"],
      },
    },
  },
  required: ["dish", "matter", "matter_why", "serving", "layers"],
  // 스트리밍으로 이 순서대로 옵니다: 이름 → 형상 → 그릇 → 바닥부터 한 층씩
  propertyOrdering: ["dish", "matter", "matter_why", "serving", "layers"],
};

function reply(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

// 스키마를 거절당하면(400) 한 단계씩 단순하게 물러섭니다.
function without(schema: unknown, keys: string[]) {
  return JSON.parse(JSON.stringify(schema), (k, v) => (keys.includes(k) ? undefined : v));
}

const SCHEMA_STEPS: (Record<string, unknown> | null)[] = [
  RESPONSE_SCHEMA,
  without(RESPONSE_SCHEMA, ["propertyOrdering"]),
  without(RESPONSE_SCHEMA, ["propertyOrdering", "nullable", "minItems", "maxItems"]),
  without(RESPONSE_SCHEMA, ["propertyOrdering", "nullable", "minItems", "maxItems", "enum"]),
  null,   // 스키마 없이, 프롬프트의 모양 설명만 믿고
];

function askGemini(model: string, apiKey: string, order: string, schema: Record<string, unknown> | null) {
  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
    temperature: 0.7,
  };
  if (schema) generationConfig.responseSchema = schema;

  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: `손님의 주문: <order>${order}</order>` }] }],
        generationConfig,
      }),
    },
  );
}

// Gemini 가 보낸 잘못 설명을 한 줄로
function geminiMessage(body: string) {
  try {
    const j = JSON.parse(body);
    return String(j.error?.message ?? "").replace(/\s+/g, " ").slice(0, 300);
  } catch {
    return body.replace(/\s+/g, " ").slice(0, 300);
  }
}

// Gemini 의 SSE 를 읽어서, 글자 조각만 다시 SSE 로 내보냄
// data: {"t":"..."}  글자 조각 /  data: {"error":"..."}  사고 /  data: {"done":true}  끝
function relay(upstream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let sent = 0;

  return new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const reader = upstream.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            let chunk;
            try {
              chunk = JSON.parse(payload);
            } catch {
              continue;
            }
            if (chunk.promptFeedback?.blockReason) {
              send({ error: `이 주문은 담아내지 못했습니다 (${chunk.promptFeedback.blockReason})` });
              continue;
            }
            const text = (chunk.candidates?.[0]?.content?.parts ?? [])
              .filter((p: { text?: string; thought?: boolean }) => p.text && !p.thought)
              .map((p: { text: string }) => p.text)
              .join("");
            if (text) {
              sent += text.length;
              send({ t: text });
            }
          }
        }
        if (!sent) send({ error: "접시가 비어 돌아왔습니다. 다시 주문해 주세요" });
        send({ done: true });
      } catch (e) {
        send({ error: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
        reader.releaseLock();
      }
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return reply({ ok: true });

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return reply({ error: "GEMINI_API_KEY 미설정 (Edge Function Secrets)" }, 500);

  try {
    // 주문 확인 (로그인은 필요 없음)
    const body = await req.json().catch(() => ({}));
    const order = String(body.order ?? "").trim();
    if (!order) return reply({ error: "무엇을 드실지 적어주세요." }, 400);
    if (order.length > MAX_ORDER) return reply({ error: `주문은 ${MAX_ORDER}자 이내로 적어주세요.` }, 400);

    // 붐비는 모델(429·503)은 건너뛰고, 스키마를 거절당하면(400) 더 단순한 스키마로
    let res: Response | undefined;
    let detail = "";
    let step = 0;

    search:
    for (const model of GEMINI_MODELS) {
      while (step < SCHEMA_STEPS.length) {
        res = await askGemini(model, apiKey, order, SCHEMA_STEPS[step]);
        if (res.ok) break search;

        const status = res.status;
        detail = geminiMessage(await res.text().catch(() => ""));
        if (status === 400) {
          console.warn(`${model} 400 (스키마 ${step}): ${detail}`);
          step += 1;                      // 같은 모델에 더 단순한 스키마로 다시
          continue;
        }
        console.warn(`${model} ${status}: ${detail}`);
        if (TRY_NEXT.includes(status)) break;   // 다음 모델로
        break search;
      }
      if (step >= SCHEMA_STEPS.length) break;
    }

    if (!res!.ok || !res!.body) {
      const status = res!.status;
      console.error(`gemini ${status}: ${detail}`);
      if (TRY_NEXT.includes(status)) {
        return reply({ error: `주방이 붐빕니다. 잠시 후 다시 주문해 주세요. (${status})` }, 503);
      }
      return reply({ error: `Gemini 오류 ${status}: ${detail}` }, 502);
    }
    if (step > 0) console.log(`스키마 ${step} 단계로 통과`);

    return new Response(relay(res!.body), {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  } catch (e) {
    console.error(e);
    return reply({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
