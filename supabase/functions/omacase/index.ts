// 오마카세 — Supabase Edge Function (이름: omacase)
// Supabase 대시보드 > Edge Functions > Deploy a new function > Via Editor 에 붙여넣고 배포
// Gemini API 키는 다른 함수와 같은 GEMINI_API_KEY (Edge Function Secrets, 프로젝트 전체 공용)
// 이 함수만 로그인 없이 누구나 부를 수 있습니다 (Visitor 용). Verify JWT 를 꺼 두세요.
//
// FOOD FORM SYSTEM
//   음식 이름 → 유형(type) → 그릇(vessel) → 구성요소(form + arrangement + modifiers) → 3D
// 음식 이름을 그대로 모델링하지 않고, 다시 쓸 수 있는 형태로 옮깁니다.
// 실제 모양·좌표·높이는 브라우저(omacase.html)가 만듭니다.

const GEMINI_MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite"];
const TRY_NEXT = [404, 429, 500, 503];

const MAX_ORDER = 60;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FOOD_TYPES = ["piece", "slice", "wrapped", "linear", "particulate", "spread", "liquid", "composite"];

const VESSELS = [
  "flat_plate", "rimmed_plate", "deep_plate", "oval_plate", "square_plate",
  "bowl", "deep_bowl", "wide_bowl", "small_bowl",
  "cup", "glass", "jar", "stone_pot",
  "tray", "board", "basket", "leaf", "none",
];

const FORMS = [
  // 덩어리
  "sphere", "ellipsoid", "cube", "cuboid", "cylinder", "capsule", "cone", "block", "wedge", "irregular_piece",
  // 납작한 것
  "sheet", "disc", "slice", "strip", "ribbon", "flake",
  // 길쭉한 것
  "strand", "noodle", "stick", "tube", "skewer",
  // 싸거나 만 것
  "roll", "dumpling", "pocket", "wrap", "nest",
  // 빈 가운데
  "ring", "torus",
  // 알갱이
  "grain", "particle", "crumb",
  // 펴 바른 것 · 액체
  "smear", "pool", "layer",
  // 그 밖
  "scoop", "heap",
];

const ARRANGEMENTS = [
  "row", "zigzag", "arc", "fan",
  "grid", "radial", "ring",
  "mound", "heap", "stack", "cluster",
  "scatter",
  "pool", "submerged", "floating",
  "nest", "bundle",
  "center", "border", "smear", "quadrant", "dot", "overlap", "pile",
];

const MODIFIERS = [
  "flatten", "elongate", "compress", "taper", "bulge",
  "bend", "curve", "twist", "warp",
  "smooth", "rough", "ridged", "wrinkled", "pleated", "crimped",
  "irregular_edge", "torn_edge", "folded_edge", "scalloped_edge",
  "layered", "wrapped", "filled", "stuffed", "stacked",
  "sliced", "diced", "quartered", "halved",
  "grilled", "fried", "baked", "charred",
];

const SYSTEM_PROMPT = `You read a food name and resolve it into a plate composition. You never draw, never
give coordinates, never invent a new shape. You choose from fixed vocabularies. The renderer owns every
shape, position and height.

FOOD NAME → TYPE → VESSEL → COMPONENTS → 3D

STEP 1 — type
The dish's dominant physical form, 1 or 2 of:
piece (독립된 덩어리: 초밥·스테이크·두부·완자), slice (얇게 썬 것: 사시미·카르파초·케이크 한 쪽),
wrapped (싸거나 만 것: 만두·김밥·타코), linear (길고 가는 것: 면·감자튀김·꼬치),
particulate (알갱이가 모인 것: 밥·리소토·견과·캐비아), spread (펴 바른 것: 퓌레·크림·소스·팬케이크),
liquid (액체: 국·카레·요거트), composite (서로 다른 요소가 함께: 비빔밥·샐러드·스테이크와 퓌레).
When a dish could be several, pick the dominant physical form. 라멘 = linear + liquid. 카레라이스 = composite.
read: one short Korean sentence saying why it is that type, naming the real dish.

STEP 2 — vessel, which follows from the type
마른 것 평평한 것 → flat_plate. 귀한 한 점씩 → rimmed_plate. 사시미 → flat_plate.
면·국 → bowl / deep_bowl. 국물이 깊으면 → deep_bowl. 구운 것·투박한 것 → board / stone_pot.
튀김·나눠 먹는 것 → basket / tray. 작은 디저트 → small_bowl. 마시는 것 → glass / cup.
망설여지면 마른 음식은 rimmed_plate, 젖었거나 수북한 음식은 bowl.
vessel_why: one short Korean sentence, naming what this dish is really served in.
size: width across in cm — 18-22 작은 접시, 22-28 메인 접시·사발, 10-14 잔.
color: the vessel's own colour.
liquid: the broth filling the vessel (colour + level 0-1), or null. Sauce on a plate is not this —
that is a component with form "pool".

STEP 3 — components, bottom first
2 to 6 components. The first ones are what lies on the vessel (밥·면·소스·도우), then what sits on them.
- food: short Korean name. form: one shape from the list. arrangement: how they sit.
- count: how many pieces. 개별 조각 3-8, 얇은 조각 3-7, 만두 4-8, 초밥 5-8,
  면은 1(한 덩어리로), 밥·알갱이는 1(렌더러가 수백 알로 그림), 샐러드 5-15,
  소스 1-5, 고명 3-10. Never hundreds of separate objects.
- size: the width of ONE piece in cm. 바닥에 까는 것 12-26, 큰 조각 3-7, 작은 조각 1.5-3.5, 고명 0.4-1.
- color, and top_color for what lies on that piece (생선·소스·치즈).
- modifiers: only what is needed to recognise the food, 0-3 of them.

FORMS
sphere ellipsoid cube cuboid cylinder capsule cone block wedge irregular_piece
sheet disc slice strip ribbon flake
strand noodle stick tube skewer
roll dumpling pocket wrap nest
ring torus
grain particle crumb
smear pool layer
scoop heap

ARRANGEMENTS
row zigzag arc fan | grid radial ring | mound heap stack cluster | scatter
pool submerged floating | nest bundle | center border smear quadrant dot overlap pile

MODIFIERS
flatten elongate compress taper bulge | bend curve twist warp
smooth rough ridged wrinkled pleated crimped | irregular_edge torn_edge folded_edge scalloped_edge
layered wrapped filled stuffed stacked | sliced diced quartered halved | grilled fried baked charred

SEMANTIC DEFAULTS
초밥 piece · capsule+sheet · rimmed_plate · row | 사시미 slice · slice · flat_plate · fan
만두 wrapped · dumpling · plate · cluster | 김밥 wrapped · roll · flat_plate · row
라멘 linear+liquid · noodle+pool · deep_bowl · submerged | 파스타 linear · strand · deep_plate · nest
감자튀김 linear · stick · basket · pile | 스테이크 piece · block · flat_plate · center
밥 particulate · grain · bowl · mound | 카레 liquid+piece · pool+chunk · bowl · submerged
비빔밥 composite · grain+pieces · bowl · mound | 샐러드 composite · leaf+pieces · bowl · cluster
퓌레 spread · smear · flat_plate · smear | 팬케이크 spread · disc · flat_plate · stack
케이크 slice · wedge · flat_plate · center | 아이스크림 piece · scoop · bowl · cluster
캐비아 particulate · grain · small_bowl · mound | 꼬치 linear · skewer · board · row

WHAT MATTERS, IN ORDER
실루엣 → 비례 → 배치 → 색 → 큰 표면 특징 → 작은 디테일.
A simple model with the right silhouette and arrangement beats a detailed one with wrong proportions.
Unknown food: infer its dominant geometry, take the closest type, form, vessel and a conventional
arrangement. Never invent a complicated one-off.

COLOURS — this kitchen's palette (every channel a multiple of 18). Stay near these:
#FCFCEA #FCFCD8 #FCEAC6 #EAD8C6 #D8C690 #D8B490 #D8B47E #D8B46C #EAB45A #EAB448 #EAC648 #FCD86C
#EA9036 #C69036 #D8905A #FC907E #D89090 #C64836 #C63624 #B45A36 #B47E48 #7E5A36 #5A3624 #242424
#7E9036 #5A9036 #6C9048 #489048 #367E36 #90486C

OUTPUT — this exact JSON object, nothing else, no code fence
{"dish":"연어 초밥","type":["piece"],"read":"밥 위에 생선을 얹어 한 점씩 집어 먹는 덩어리 음식이다.",
"serving":{"vessel":"rimmed_plate","vessel_why":"초밥은 한 점씩 놓는 테두리 접시에 낸다.","size":24,
"color":"#FCFCEA","liquid":null},
"components":[
{"food":"초밥","form":"capsule","arrangement":"row","count":6,"size":4.2,"color":"#FCFCEA",
"top_color":"#EA9036","modifiers":["flatten"]},
{"food":"생강","form":"flake","arrangement":"cluster","count":5,"size":1.4,"color":"#FCEAC6","modifiers":[]},
{"food":"간장","form":"pool","arrangement":"dot","count":1,"size":3,"color":"#5A3624","modifiers":[]}]}`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    dish: { type: "STRING" },
    type: { type: "ARRAY", minItems: 1, maxItems: 2, items: { type: "STRING", enum: FOOD_TYPES } },
    read: { type: "STRING" },
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
          properties: { color: { type: "STRING" }, level: { type: "NUMBER" } },
          required: ["color", "level"],
          propertyOrdering: ["color", "level"],
        },
      },
      required: ["vessel", "vessel_why", "size", "color"],
      propertyOrdering: ["vessel", "vessel_why", "size", "color", "liquid"],
    },
    components: {
      type: "ARRAY",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "OBJECT",
        properties: {
          food: { type: "STRING" },
          form: { type: "STRING", enum: FORMS },
          arrangement: { type: "STRING", enum: ARRANGEMENTS },
          count: { type: "INTEGER" },
          size: { type: "NUMBER" },
          color: { type: "STRING" },
          top_color: { type: "STRING" },
          modifiers: { type: "ARRAY", maxItems: 3, items: { type: "STRING", enum: MODIFIERS } },
        },
        required: ["food", "form", "arrangement", "count", "size", "color"],
        propertyOrdering: ["food", "form", "arrangement", "count", "size", "color", "top_color", "modifiers"],
      },
    },
  },
  required: ["dish", "type", "read", "serving", "components"],
  // 스트리밍으로 이 순서대로 옵니다: 이름 → 유형 → 그릇 → 구성요소(바닥부터)
  propertyOrdering: ["dish", "type", "read", "serving", "components"],
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
