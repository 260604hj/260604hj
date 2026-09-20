// 오마카세 — Supabase Edge Function (이름: omacase)
// Supabase 대시보드 > Edge Functions > Deploy a new function > Via Editor 에 붙여넣고 배포
// Gemini API 키는 다른 함수와 같은 GEMINI_API_KEY (Edge Function Secrets, 프로젝트 전체 공용)
// 이 함수만 로그인 없이 누구나 부를 수 있습니다 (Visitor 용). Verify JWT 를 꺼 두세요.
//
// 모델은 좌표를 계산하지 않습니다. "무슨 그릇에 어떤 모양으로 몇 개를 어떻게 담는가" 만 고르고,
// 그릇 모양과 자리 계산은 브라우저(omacase.html)가 합니다. 그래서 응답이 짧고 빠르고 덜 틀립니다.
// 응답은 스트리밍입니다.

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
const ARRANGEMENTS = ["row", "grid", "ring", "fan", "mound", "stack", "scatter", "submerged"];
const FORMS = [
  "nigiri", "dumpling", "roll", "slice", "cube", "ball",
  "scoop", "noodle_nest", "skewer", "heap", "ring", "sheet", "custom",
];

const SYSTEM_PROMPT = `You are a food stylist for a miniature 3D restaurant. You do not draw and you do not
compute coordinates. You answer one question: how is this exact dish really served, and what is on it?
The renderer owns the geometry — it knows how to build each vessel and each form, and where to put things.

DECIDE IN THIS ORDER, AND SHOW YOUR REASONING AS YOU GO
1. matter — what state the food is in, because that decides the vessel:
   drink (마시는 액체), soup (국물 있는 음식), grain (밥·샐러드처럼 알갱이가 모인 것),
   noodle (면), object (빵·초밥·고기처럼 덩어리로 집어 먹는 것).
   matter_why: one short Korean sentence saying why, naming the dish's real form.
2. vessel — the container that matter and that dish actually come in.
   vessel_why: one short Korean sentence, naming what the dish is really served in.
3. the rest — liquid, arrangement, count, then the bites one by one.
Each step follows from the one before it. Never contradict a step you already wrote.

REMEMBER THE REAL DISH
Before choosing anything, picture the dish as it is actually served in its own country.
- What vessel does it come in? Ramen comes in a deep bowl, not on a plate. Bibimbap comes in a stone pot.
  Nigiri comes on a flat plate or a wooden board. Bingsu comes in a wide bowl. Tteokbokki in a shallow bowl
  with red broth. Pizza on a board. Beer or smoothie in a glass. Fried chicken in a basket.
- Is there liquid? Broth, soup, sauce, syrup, milk — say so and give its colour and how full the vessel is.
- How is it laid out? A row of nigiri, a ring of dumplings, a mound of shaved ice, a nest of noodles
  submerged in broth, slices fanned out, skewers laid in a row.
- What is one mouthful of it? The person picks up one piece at a time.
Never substitute a different dish. If the order is vague, pick one specific real dish and name it in dish.
If the order is not food, build the closest edible thing.

VESSEL — pick the one that is actually used, and let matter decide it
drink → glass. soup and noodle → deep_bowl (or bowl when it is served wide, stone_pot when it bubbles).
grain → bowl, stone_pot, or rimmed_plate. object → flat_plate, board or basket.
- flat_plate: 평평한 접시. Nigiri, cake slices, grilled meat, sandwiches.
- rimmed_plate: 테두리 있는 접시. Pasta, curry with rice, saucy dishes with no deep broth.
- bowl: 사발. Bingsu, salad, rice bowls, stew served wide, ice cream.
- deep_bowl: 깊은 면기. Ramen, pho, udon, soup with noodles submerged.
- stone_pot: 돌솥·뚝배기. Bibimbap, sundubu, anything served bubbling.
- board: 나무 도마. Pizza, bread, cheese, sushi geta, barbecue.
- basket: 바구니. Fried chicken, chips, street food, steamed buns.
- glass: 유리잔. Drinks, smoothies, parfait, affogato.
size is the width across, in cm: 16-20 for a small plate or glass, 20-26 for a main plate or bowl.
color is the vessel's own colour: white "#F2F0EC", dark slate "#39463F", wood "#B08050",
black stone "#3A3632", glass "#CFE0E6", woven basket "#C8A66B".
liquid is the broth or sauce lying in the vessel: colour plus level 0-1 (how full). null when the dish is dry.

ARRANGEMENT — how the mouthfuls sit in the vessel
row (한 줄), grid (격자), ring (둥글게), fan (부채꼴), mound (수북이 쌓기),
stack (위로 포개기), scatter (흩뿌리기), submerged (국물에 잠기게).
count is how many mouthfuls: 4 to 9.

BITES — each one is a single mouthful, in the order they sit
- form is the shape the renderer builds:
  nigiri (초밥 한 점), dumpling (만두·교자), roll (김밥·마키 한 조각), slice (얇게 썬 조각),
  cube (깍둑 썬 덩이), ball (동그란 덩이), scoop (한 숟갈 퍼 담은 덩이), noodle_nest (면 뭉치),
  skewer (꼬치), heap (수북한 더미), ring (고리 모양), sheet (넓고 얇은 조각), custom (그 밖의 것).
- base_color is the body of the bite, top_color what lies on top (fish, sauce, cheese, syrup). Real colours:
  rice "#FDFBF7", salmon "#F08050", tuna "#B3223A", nori "#2B2B2B", shaved ice "#F3F7FA",
  strawberry "#E23B4A", condensed milk "#FFFDF6", basil "#4C8A3F", char "#4A2E1E", cheese "#F0C860".
- scale 0.7-1.4, larger for a big piece of meat, smaller for a berry.
- toppings: 0 to 3 small things sprinkled on that bite — each is a colour plus one of
  dot, stick, flake. Sesame, herbs, chilli, chocolate, spring onion.
- Vary the bites where the real dish varies (a sushi plate), keep them alike where it does not (dumplings).
- Use form "custom" only when nothing else fits, and then give parts: simple shapes
  (box, sphere, cylinder, cone, capsule, torus) with color and size [x,y,z] in cm, around 3-5 cm per bite.
  The renderer places the bite; parts are positioned relative to the bite's own centre, y = 0 at its bottom.

OUTPUT — return exactly this JSON object, nothing else, no code fence
{"dish":"돈코츠 라멘","matter":"noodle","matter_why":"...","serving":{"vessel":"deep_bowl",
"vessel_why":"...","size":22,"color":"#39463F","liquid":{"color":"#E8D9B5","level":0.6},
"arrangement":"submerged","count":6},"bites":[{"name":"면 한 젓가락","form":"noodle_nest",
"base_color":"#F2E3B8","top_color":"#E8D9B5","scale":1,"toppings":[{"kind":"flake","color":"#4C8A3F"}]}]}
- dish: short Korean name matching the order. liquid may be omitted when the dish is dry.`;

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
        arrangement: { type: "STRING", enum: ARRANGEMENTS },
        count: { type: "INTEGER" },
      },
      required: ["vessel", "vessel_why", "size", "color", "arrangement", "count"],
      propertyOrdering: ["vessel", "vessel_why", "size", "color", "liquid", "arrangement", "count"],
    },
    bites: {
      type: "ARRAY",
      minItems: 4,
      maxItems: 9,
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          form: { type: "STRING", enum: FORMS },
          base_color: { type: "STRING" },
          top_color: { type: "STRING" },
          scale: { type: "NUMBER" },
          toppings: {
            type: "ARRAY",
            maxItems: 3,
            items: {
              type: "OBJECT",
              properties: {
                kind: { type: "STRING", enum: ["dot", "stick", "flake"] },
                color: { type: "STRING" },
              },
              required: ["kind", "color"],
              propertyOrdering: ["kind", "color"],
            },
          },
          parts: {
            type: "ARRAY",
            maxItems: 5,
            items: {
              type: "OBJECT",
              properties: {
                shape: { type: "STRING", enum: ["box", "sphere", "cylinder", "cone", "torus", "capsule"] },
                color: { type: "STRING" },
                size: { type: "ARRAY", items: { type: "NUMBER" } },
                pos: { type: "ARRAY", items: { type: "NUMBER" } },
                rot: { type: "ARRAY", items: { type: "NUMBER" } },
              },
              required: ["shape", "color", "size"],
              propertyOrdering: ["shape", "color", "size", "pos", "rot"],
            },
          },
        },
        required: ["name", "form", "base_color"],
        propertyOrdering: ["name", "form", "base_color", "top_color", "scale", "toppings", "parts"],
      },
    },
  },
  required: ["dish", "matter", "matter_why", "serving", "bites"],
  // 스트리밍으로 이 순서대로 옵니다: 이름 → 형상 → 그릇 → 담기 → 한 입씩
  propertyOrdering: ["dish", "matter", "matter_why", "serving", "bites"],
};

function reply(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

// 스키마를 거절당하면(400) 한 단계씩 단순하게 물러섭니다.
// Gemini 쪽에서 지원하지 않는 항목이 있어도 앱이 멈추지 않게 하려는 것.
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
