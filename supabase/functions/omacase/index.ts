// 오마카세 — Supabase Edge Function (이름: omacase)
// Supabase 대시보드 > Edge Functions > Deploy a new function > Via Editor 에 붙여넣고 배포
// Gemini API 키는 다른 함수와 같은 GEMINI_API_KEY (Edge Function Secrets, 프로젝트 전체 공용)
// 이 함수만 로그인 없이 누구나 부를 수 있습니다 (Visitor 용).
// 대시보드에서 이 함수의 Verify JWT 를 꺼 두세요.

const GEMINI_MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite"];
const TRY_NEXT = [404, 429, 500, 503];

const MAX_ORDER = 60;
const MAX_ITEMS = 9;
const MAX_PARTS = 5;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `You are a 3D food stylist. You describe a dish as a small set of simple
solid shapes, so a three.js renderer can build it. You never write code. You only return the JSON
object that matches the given schema.

STYLE
- Low-poly toy food, seen in isometric view on a plate, like a miniature model.
- Every part is flat-coloured. No textures, no gradients. Colours are hex strings like "#E8734A".
- Keep it readable, not realistic. A shrimp nigiri is a rice cylinder plus an orange-pink capsule.

COORDINATES AND UNITS
- 1 unit = 1 cm. The plate top surface is y = 0. Up is +y.
- pos is the CENTRE of the part, relative to the centre of the plate.
- size is the bounding box [x, y, z] of the part in cm.
- rot is [x, y, z] in DEGREES. Omit it when there is no rotation.
- Nothing may sit below y = 0. A part of height h resting on the plate has pos y = h / 2.
- Keep every part inside the plate: |pos x| < width/2 - 1, |pos z| < depth/2 - 1.

SHAPES (all sized by their bounding box)
- box: a cuboid.
- sphere: an ellipsoid.
- cylinder: a disc or tube, its axis along y before rotation.
- cone: a cone, its tip pointing +y before rotation.
- capsule: a rounded rod, its axis along y before rotation. Good for shrimp, sausage, fingers of food.
- torus: a flat ring lying on the plate before rotation. Good for onion rings, donuts, noodles.

ITEMS
- items is the list of BITES. The person clicks one bite and eats it, so each item must be one
  mouthful that makes sense on its own: one piece of sushi, one dumpling, one small heap of pasta,
  one slice of cake.
- Give between 4 and ${MAX_ITEMS} items. Each item has 1 to ${MAX_PARTS} parts.
- Spread the items over the plate so they do not overlap each other.
- Vary the items a little. A real omakase plate is not 6 identical objects in a straight line.
- name is a short Korean name for that bite, such as "연어 초밥".

PLATE
- width and depth are in cm, usually between 16 and 26.
- Use "circle" for a round plate, "ellipse" for a long oval one, "square" for a square one.
- Plate colour is usually near-white "#F2F0EC", but dark slate "#39463F" or wood "#B08050" suit
  some dishes better.

OUTPUT
- dish is a short Korean name for the whole dish.
- Return the JSON object only.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    dish: { type: "STRING" },
    plate: {
      type: "OBJECT",
      properties: {
        shape: { type: "STRING", enum: ["circle", "ellipse", "square"] },
        color: { type: "STRING" },
        width: { type: "NUMBER" },
        depth: { type: "NUMBER" },
      },
      required: ["shape", "color", "width", "depth"],
    },
    items: {
      type: "ARRAY",
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
            },
          },
        },
        required: ["name", "parts"],
      },
    },
  },
  required: ["dish", "plate", "items"],
};

function reply(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

async function askGemini(model: string, apiKey: string, order: string) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: `손님의 주문: <order>${order}</order>` }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 1.0,
        },
      }),
    },
  );
  return { res, data: await res.json() };
}

const SHAPES = ["box", "sphere", "cylinder", "cone", "torus", "capsule"];

const num = (v: unknown, d: number) => (typeof v === "number" && isFinite(v) ? v : d);
const triple = (v: unknown, d: number) => {
  const a = Array.isArray(v) ? v : [];
  return [num(a[0], d), num(a[1], d), num(a[2], d)];
};
const color = (v: unknown, d: string) => {
  const s = String(v ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : d;
};

// 화면에서 깨지지 않게 모양·색·크기를 정리
function cleanSpec(spec: Record<string, any>) {
  const plate = spec.plate ?? {};
  const shape = ["circle", "ellipse", "square"].includes(plate.shape) ? plate.shape : "circle";
  const width = Math.min(40, Math.max(10, num(plate.width, 20)));
  const depth = shape === "circle" ? width : Math.min(40, Math.max(10, num(plate.depth, width)));

  const items = (Array.isArray(spec.items) ? spec.items : [])
    .slice(0, MAX_ITEMS)
    .map((item: Record<string, any>) => ({
      name: String(item?.name ?? "한 점").trim().slice(0, 20) || "한 점",
      parts: (Array.isArray(item?.parts) ? item.parts : [])
        .slice(0, MAX_PARTS)
        .map((p: Record<string, any>) => {
          const size = triple(p?.size, 1).map((n) => Math.min(20, Math.max(0.05, n)));
          const pos = triple(p?.pos, 0);
          return {
            shape: SHAPES.includes(p?.shape) ? p.shape : "box",
            color: color(p?.color, "#CCCCCC"),
            size,
            pos: [pos[0], Math.max(0, pos[1]), pos[2]],
            rot: triple(p?.rot, 0),
          };
        }),
    }))
    .filter((item: { parts: unknown[] }) => item.parts.length);

  return {
    dish: String(spec.dish ?? "").trim().slice(0, 40),
    plate: { shape, color: color(plate.color, "#F2F0EC"), width, depth },
    items,
  };
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

    let model = "", res: Response | undefined, data;
    for (model of GEMINI_MODELS) {
      ({ res, data } = await askGemini(model, apiKey, order));
      if (res.ok || !TRY_NEXT.includes(res.status)) break;
      console.warn(`${model} ${res.status}: ${data.error?.message ?? ""}`);
    }

    if (!res!.ok) {
      const detail = `${res!.status}: ${data.error?.message ?? ""}`;
      if (TRY_NEXT.includes(res!.status)) {
        return reply({ error: `주방이 붐빕니다. 잠시 후 다시 주문해 주세요. (${detail})` }, 503);
      }
      return reply({ error: `Gemini 오류 ${detail}` }, 502);
    }
    if (data.promptFeedback?.blockReason) {
      return reply({ error: `이 주문은 담아내지 못했습니다 (${data.promptFeedback.blockReason})` }, 422);
    }

    const candidate = data.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .filter((part: { text?: string; thought?: boolean }) => part.text && !part.thought)
      .map((part: { text: string }) => part.text)
      .join("");
    let spec;
    try {
      spec = JSON.parse(text);
    } catch {
      return reply({ error: `접시가 비어 돌아왔습니다 (${candidate?.finishReason ?? "응답 없음"}). 다시 주문해 주세요.` }, 502);
    }

    const clean = cleanSpec(spec);
    if (!clean.items.length) {
      return reply({ error: "이 주문은 담아내지 못했습니다. 다르게 말씀해 주세요." }, 502);
    }
    return reply({ ...clean, model });
  } catch (e) {
    console.error(e);
    return reply({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
