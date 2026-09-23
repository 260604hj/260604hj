// A Place for Today — Supabase Edge Function (이름: place)
// Supabase 대시보드 > Edge Functions > Deploy a new function > Via Editor 에 붙여넣고 배포
// Gemini API 키는 다른 함수와 같은 GEMINI_API_KEY (Edge Function Secrets, 프로젝트 전체 공용)
// 이 함수도 로그인 없이 누구나 부를 수 있습니다 (Visitor 용). Verify JWT 를 꺼 두세요.
//
// 이름과 생년월일 → 오늘의 운세 → 그 운세에 맞는 제3의 장소(집도 직장도 아닌 곳)
//   장소 성격 → 방 크기·색·빛 → 창문 → 바깥(도시/숲) → 가구
// 좌표와 모양은 브라우저(place.html)가 만듭니다. 서버는 정해진 어휘에서 고르기만 합니다.

const GEMINI_MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite"];
const TRY_NEXT = [404, 429, 500, 503];

const MAX_NAME = 20;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PLACES = [
  "cafe", "library", "bookshop", "record_shop", "bathhouse", "tea_house",
  "bar", "greenhouse", "studio", "laundromat", "barbershop", "gallery",
  "pavilion", "community_hall", "sauna", "diner",
];
const LIGHTS = ["warm", "neutral", "cool"];
const WALLS = ["left", "right", "back"];
const OUTSIDES = ["city", "forest"];
const TIMES = ["morning", "day", "dusk", "night"];
const ITEMS = [
  "sofa", "armchair", "chair", "stool", "bench", "table", "coffee_table",
  "counter", "shelf", "bookshelf", "rug", "plant", "floor_lamp", "pendant",
  "cushion", "tub", "bar_stool", "side_table",
];
const STYLES = ["minimal", "plush", "wooden", "industrial", "vintage", "woven"];
const SPOTS = ["center", "back", "left", "right", "corner", "window", "front"];

const SYSTEM_PROMPT = `You read a guest's day, then give them a third place for it.

A third place (Ray Oldenburg) is neither home (the first place) nor work (the second): it is the
café, the library, the bathhouse, the record shop, the greenhouse, the neighbourhood bar — neutral
ground where nobody hosts, where talk or quiet is the main activity, where you can arrive alone and
still belong. It is easy to reach, low-key, a little playful, and it feels like a living room that is
not yours. You choose one such place for today and describe the room it lives in.

You never draw and never give coordinates. You choose from fixed vocabularies. The renderer builds
every shape, position and height.

NAME + BIRTHDAY → FORTUNE → PLACE → ROOM → WINDOWS → OUTSIDE → FURNITURE → 3D

STEP 1 — fortune, in Korean, in three parts
- luck: today in one short line, at most 14 characters, no ending punctuation.
- overall (총운): 2 sentences on the shape of the day. Call the guest once by the exact name given
  inside <name></name>, warmly — copy it letter for letter and never invent or swap in another name.
- inner (내면운): 2 sentences on their own mind today.
- relation (관계운): 2 sentences on people.
Draw lightly on the birthday — zodiac animal, the season they were born in, the year's element — and
on today's date. Be concrete, never generic, and never repeat the same idea three times.
Keep it kind and playful. Never predict illness, death or loss, and never give medical, legal or
financial advice.
- color: one colour from the palette that suits the day.

STEP 2 — the place that answers it
kind: cafe, library, bookshop, record_shop, bathhouse, tea_house, bar, greenhouse, studio,
laundromat, barbershop, gallery, pavilion, community_hall, sauna, diner.
- A day that needs quiet gets a library or a tea house; a day that needs people gets a diner or a bar;
  a day that needs to start over gets a bathhouse or a laundromat; a day that needs making gets a studio.
- name: a short Korean name for this particular place, like a sign over the door (예: 오후 세 시 서점).
- why: one short Korean sentence tying the place to the fortune.

STEP 3 — the room
w, d, h in metres, each between 3 and 6, and they are a proportion, not a size:
a day that needs shelter is narrow and low (3-4 m), a day that needs air is wide and tall (5-6 m).
wall_color, floor_color, accent_color: from the palette. light: warm, neutral or cool.
The room is a box with exactly one side open, towards the viewer. Do not describe that side.

STEP 4 — windows, 1 to 3
Each: wall (left, right or back), width and height in metres (0.6-3.5), sill — the height of its
bottom edge above the floor in metres (0-1.8). A bright day wants a wide low window; a day for hiding
wants one small high one. Windows must fit inside their wall.

STEP 5 — outside, seen through the windows
kind: city or forest. time: morning, day, dusk or night.

STEP 6 — furniture, 3 to 8 pieces
- item: sofa, armchair, chair, stool, bench, table, coffee_table, counter, shelf, bookshelf, rug,
  plant, floor_lamp, pendant, cushion, tub, bar_stool, side_table.
- style: minimal (가는 선, 얇은 판), plush (푹신하고 둥근), wooden (두툼한 나무),
  industrial (검은 철제), vintage (곡선 다리), woven (엮은 라탄).
- color: from the palette. place: center, back, left, right, corner, window or front.
- Mix styles and colours; a third place is furnished over years, not bought in one set.
- Give what the place actually needs: a café has a counter and small tables, a library has shelves and
  one good chair, a bathhouse has a tub and a bench, a record shop has shelves and a stool.
- A rug goes under things; a pendant hangs from the ceiling; a plant likes a corner or a window.

COLOURS — this room's palette (every channel a multiple of 18). Stay near these:
#FCFCEA #FCFCD8 #FCEAC6 #EAD8C6 #D8C690 #D8B490 #D8B47E #D8B46C #EAB45A #EAB448 #EAC648 #FCD86C
#EA9036 #C69036 #D8905A #FC907E #D89090 #C64836 #C63624 #B45A36 #B47E48 #7E5A36 #5A3624 #242424
#7E9036 #5A9036 #6C9048 #489048 #367E36 #90486C #6C7E90 #90A8B4 #C6D8D8 #A8B4C6

OUTPUT — this exact JSON object, nothing else, no code fence
{"fortune":{"luck":"한 박자 쉬어 가는 날",
"overall":"희진 님, 봄에 태어난 사람은 오늘처럼 흐린 날 오히려 차분해집니다. 오전에 하나만 끝내고 나머지는 오후로 미뤄도 좋습니다.",
"inner":"생각이 앞서 달립니다. 손을 잠깐 멈추면 순서가 보입니다.",
"relation":"먼저 연락하기 좋은 날입니다. 짧은 인사 하나면 충분합니다.","color":"#90A8B4"},
"place":{"kind":"cafe","name":"오후 세 시 카페","why":"한 박자 쉬어 가려면 남의 거실 같은 자리가 필요합니다."},
"room":{"w":5,"d":4.5,"h":3.4,"wall_color":"#EAD8C6","floor_color":"#B47E48","accent_color":"#5A9036","light":"warm"},
"windows":[{"wall":"back","width":2.6,"height":1.6,"sill":0.9},{"wall":"left","width":1.0,"height":1.0,"sill":1.4}],
"outside":{"kind":"city","time":"dusk"},
"furniture":[{"item":"counter","style":"wooden","color":"#7E5A36","place":"back"},
{"item":"sofa","style":"plush","color":"#6C7E90","place":"left"},
{"item":"coffee_table","style":"minimal","color":"#242424","place":"center"},
{"item":"stool","style":"wooden","color":"#D8B47E","place":"back"},
{"item":"rug","style":"woven","color":"#D8C690","place":"center"},
{"item":"plant","style":"woven","color":"#5A9036","place":"corner"},
{"item":"pendant","style":"industrial","color":"#242424","place":"center"}]}`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    fortune: {
      type: "OBJECT",
      properties: {
        luck: { type: "STRING" },
        overall: { type: "STRING" },
        inner: { type: "STRING" },
        relation: { type: "STRING" },
        color: { type: "STRING" },
      },
      required: ["luck", "overall", "inner", "relation"],
      propertyOrdering: ["luck", "overall", "inner", "relation", "color"],
    },
    place: {
      type: "OBJECT",
      properties: {
        kind: { type: "STRING", enum: PLACES },
        name: { type: "STRING" },
        why: { type: "STRING" },
      },
      required: ["kind", "name", "why"],
      propertyOrdering: ["kind", "name", "why"],
    },
    room: {
      type: "OBJECT",
      properties: {
        w: { type: "NUMBER" },
        d: { type: "NUMBER" },
        h: { type: "NUMBER" },
        wall_color: { type: "STRING" },
        floor_color: { type: "STRING" },
        accent_color: { type: "STRING" },
        light: { type: "STRING", enum: LIGHTS },
      },
      required: ["w", "d", "h", "wall_color", "floor_color", "light"],
      propertyOrdering: ["w", "d", "h", "wall_color", "floor_color", "accent_color", "light"],
    },
    windows: {
      type: "ARRAY",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "OBJECT",
        properties: {
          wall: { type: "STRING", enum: WALLS },
          width: { type: "NUMBER" },
          height: { type: "NUMBER" },
          sill: { type: "NUMBER" },
        },
        required: ["wall", "width", "height", "sill"],
        propertyOrdering: ["wall", "width", "height", "sill"],
      },
    },
    outside: {
      type: "OBJECT",
      properties: {
        kind: { type: "STRING", enum: OUTSIDES },
        time: { type: "STRING", enum: TIMES },
      },
      required: ["kind", "time"],
      propertyOrdering: ["kind", "time"],
    },
    furniture: {
      type: "ARRAY",
      minItems: 3,
      maxItems: 8,
      items: {
        type: "OBJECT",
        properties: {
          item: { type: "STRING", enum: ITEMS },
          style: { type: "STRING", enum: STYLES },
          color: { type: "STRING" },
          place: { type: "STRING", enum: SPOTS },
        },
        required: ["item", "style", "color", "place"],
        propertyOrdering: ["item", "style", "color", "place"],
      },
    },
  },
  required: ["fortune", "place", "room", "windows", "outside", "furniture"],
  // 스트리밍으로 이 순서대로: 운세 → 장소 → 방 → 창 → 바깥 → 가구
  propertyOrdering: ["fortune", "place", "room", "windows", "outside", "furniture"],
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

function askGemini(model: string, apiKey: string, ask: string, schema: Record<string, unknown> | null) {
  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
    temperature: 0.9,
  };
  if (schema) generationConfig.responseSchema = schema;

  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: ask }] }],
        generationConfig,
      }),
    },
  );
}

function geminiMessage(body: string) {
  try {
    const j = JSON.parse(body);
    return String(j.error?.message ?? "").replace(/\s+/g, " ").slice(0, 300);
  } catch {
    return body.replace(/\s+/g, " ").slice(0, 300);
  }
}

// Gemini 의 SSE 를 읽어서, 글자 조각만 다시 SSE 로 내보냄
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
              send({ error: `오늘은 자리를 내어 드리지 못했습니다 (${chunk.promptFeedback.blockReason})` });
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
        if (!sent) send({ error: "빈 방이 돌아왔습니다. 다시 받아 주세요" });
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
    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? "").trim();
    const birth = String(body.birth ?? "").trim();
    const today = String(body.today ?? "").trim().slice(0, 10);

    if (!name) return reply({ error: "이름을 적어주세요." }, 400);
    if (name.length > MAX_NAME) return reply({ error: `이름은 ${MAX_NAME}자 이내로 적어주세요.` }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) return reply({ error: "생년월일을 골라주세요." }, 400);

    const ask = `손님: <name>${name}</name> <birthday>${birth}</birthday> <today>${today}</today>
`
      + `이 손님의 이름은 "${name}" 입니다. 다른 이름을 지어내지 말고 "${name} 님" 이라고 부르세요.`;

    // 붐비는 모델(429·503)은 건너뛰고, 스키마를 거절당하면(400) 더 단순한 스키마로
    let res: Response | undefined;
    let detail = "";
    let step = 0;

    search:
    for (const model of GEMINI_MODELS) {
      while (step < SCHEMA_STEPS.length) {
        res = await askGemini(model, apiKey, ask, SCHEMA_STEPS[step]);
        if (res.ok) break search;

        const status = res.status;
        detail = geminiMessage(await res.text().catch(() => ""));
        if (status === 400) {
          console.warn(`${model} 400 (스키마 ${step}): ${detail}`);
          step += 1;
          continue;
        }
        console.warn(`${model} ${status}: ${detail}`);
        if (TRY_NEXT.includes(status)) break;
        break search;
      }
      if (step >= SCHEMA_STEPS.length) break;
    }

    if (!res!.ok || !res!.body) {
      const status = res!.status;
      console.error(`gemini ${status}: ${detail}`);
      if (TRY_NEXT.includes(status)) {
        return reply({ error: `자리가 붐빕니다. 잠시 후 다시 받아 주세요. (${status})` }, 503);
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
