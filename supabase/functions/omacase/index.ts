// 오마카세 — Supabase Edge Function (이름: omacase)
// Supabase 대시보드 > Edge Functions > Deploy a new function > Via Editor 에 붙여넣고 배포
// Gemini API 키는 다른 함수와 같은 GEMINI_API_KEY (Edge Function Secrets, 프로젝트 전체 공용)
// 이 함수만 로그인 없이 누구나 부를 수 있습니다 (Visitor 용). Verify JWT 를 꺼 두세요.
//
// 응답은 스트리밍입니다. Gemini 가 글자를 만들어 내는 대로 그대로 흘려보내고,
// 브라우저가 반쯤 온 JSON 을 읽어 가며 접시를 하나씩 쌓습니다.

const GEMINI_MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite"];
const TRY_NEXT = [404, 429, 500, 503];

const MAX_ORDER = 60;
const MAX_ITEMS = 9;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `You are a 3D food stylist. You describe a dish as a small set of simple
solid shapes, so a three.js renderer can build it. You never write code. You only return the JSON
object that matches the given schema.

FIRST RULE — BUILD WHAT WAS ORDERED
- The order is the dish. Never substitute another dish, never drift to a dish you find easier.
  "딸기 빙수" is shaved ice with strawberries, not dumplings. "마르게리타 피자" is a round pizza
  with red sauce, white mozzarella and green basil, not sushi.
- Work it out before you build: what does this exact food look like — its container, its colour,
  its texture, how it is served, how a person eats it. Write that in plan, then build it.
- Use the real colours of that food. Rice is off-white "#FDFBF7", salmon "#F08050", nori "#2B2B2B",
  strawberry "#E23B4A", condensed milk "#FFFDF6", basil "#4C8A3F", char on grilled meat "#4A2E1E".
- If the order names a country or a style (Korean, Italian, street food), keep to it.
- If the order is vague ("아무거나", "맛있는 거"), choose one specific real dish and name it in dish.
- If the order is not food, build the closest edible thing and say so in plan.

STYLE
- Low-poly toy food, seen in isometric view on a plate, like a miniature model.
- Every part is flat-coloured. No textures, no gradients. Colours are hex strings like "#E8734A".
- Readable, not realistic: a shrimp nigiri is a rice cylinder plus an orange-pink capsule.
- A bowl dish (bingsu, ramen, stew) is still built on the plate: use a wide cylinder as the bowl,
  then heap the food on top of it. Rings and cones read well as noodles, ice and toppings.

COORDINATES AND UNITS
- 1 unit = 1 cm. The plate top surface is y = 0. Up is +y.
- pos is the CENTRE of the part, relative to the centre of the plate.
- size is the bounding box [x, y, z] of the part in cm.
- rot is [x, y, z] in DEGREES. Omit it when there is no rotation.
- Nothing may sit below y = 0. A part of height h resting on the plate has pos y = h / 2.
  A part stacked on top of another has pos y = (height of what is under it) + h / 2.
- Keep every part inside the plate: |pos x| < width/2 - 1, |pos z| < depth/2 - 1.

SHAPES (all sized by their bounding box)
- box: a cuboid. Bread, tofu, cake, sushi rice seen square-on.
- sphere: an ellipsoid. Meatballs, fruit, scoops.
- cylinder: a disc or tube, axis along y before rotation. Bowls, rice, sausage slices, cups.
- cone: a cone, tip pointing +y before rotation. Heaps, ice, shaved toppings, carrot pieces.
- capsule: a rounded rod, axis along y before rotation. Shrimp, sausage, fingers of food.
- torus: a flat ring lying on the plate before rotation. Onion rings, donuts, coiled noodles.

ITEMS
- items is the list of BITES. The person clicks one bite and eats it, so each item must be one
  mouthful that makes sense on its own: one piece of sushi, one dumpling, one spoonful of bingsu,
  one slice of cake.
- Give between 4 and ${MAX_ITEMS} items. Each item has 1 to 5 parts.
- Spread the items over the plate so they do not overlap each other.
- Vary them. A real plate is not 6 identical objects in a straight line. When one dish is served as
  one mass (bingsu, pasta), cut it into 4-9 spoon-sized heaps sitting side by side.
- name is a short Korean name for that bite, such as "연어 초밥".

PLATE
- width and depth are in cm, usually between 16 and 26.
- "circle" for round, "ellipse" for a long oval, "square" for square.
- Plate colour follows the food: near-white "#F2F0EC" for most, dark slate "#39463F" for sushi and
  grilled meat, wood "#B08050" for bread and street food, glass-grey "#DCE3E6" for cold desserts.

PLAN
- plan is 2-3 short Korean sentences, written before you build, saying what this exact dish looks
  like and how you will lay it out. Plain and concrete, no greetings.

OUTPUT
- dish is a short Korean name for the whole dish, matching the order.
- Return the JSON object only.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    dish: { type: "STRING" },
    plan: { type: "STRING" },
    plate: {
      type: "OBJECT",
      properties: {
        shape: { type: "STRING", enum: ["circle", "ellipse", "square"] },
        color: { type: "STRING" },
        width: { type: "NUMBER" },
        depth: { type: "NUMBER" },
      },
      required: ["shape", "color", "width", "depth"],
      propertyOrdering: ["shape", "color", "width", "depth"],
    },
    items: {
      type: "ARRAY",
      minItems: 4,
      maxItems: MAX_ITEMS,
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          parts: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                shape: { type: "STRING", enum: ["box", "sphere", "cylinder", "cone", "torus", "capsule"] },
                color: { type: "STRING" },
                size: { type: "ARRAY", items: { type: "NUMBER" } },
                pos: { type: "ARRAY", items: { type: "NUMBER" } },
                rot: { type: "ARRAY", items: { type: "NUMBER" } },
              },
              required: ["shape", "color", "size", "pos"],
              propertyOrdering: ["shape", "color", "size", "pos", "rot"],
            },
          },
        },
        required: ["name", "parts"],
        propertyOrdering: ["name", "parts"],
      },
    },
  },
  required: ["dish", "plan", "plate", "items"],
  // 스트리밍으로 받을 때 이 순서대로 옵니다: 이름 → 구상 → 접시 → 음식
  propertyOrdering: ["dish", "plan", "plate", "items"],
};

function reply(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

function askGemini(model: string, apiKey: string, order: string) {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: `손님의 주문: <order>${order}</order>` }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.7,
        },
      }),
    },
  );
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

    // 붐비는 모델은 건너뛰고, 글자가 나오기 시작한 모델로 이어붙임
    let res: Response | undefined;
    for (const model of GEMINI_MODELS) {
      res = await askGemini(model, apiKey, order);
      if (res.ok || !TRY_NEXT.includes(res.status)) break;
      console.warn(`${model} ${res.status}`);
      await res.body?.cancel();
    }

    if (!res!.ok || !res!.body) {
      const detail = await res!.text().catch(() => "");
      const status = res!.status;
      console.error(`gemini ${status}: ${detail.slice(0, 300)}`);
      if (TRY_NEXT.includes(status)) {
        return reply({ error: `주방이 붐빕니다. 잠시 후 다시 주문해 주세요. (${status})` }, 503);
      }
      return reply({ error: `Gemini 오류 ${status}` }, 502);
    }

    return new Response(relay(res!.body), {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  } catch (e) {
    console.error(e);
    return reply({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
