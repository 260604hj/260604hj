// 오마카세 — Supabase Edge Function (이름: omacase)
// Supabase 대시보드 > Edge Functions > Deploy a new function > Via Editor 에 붙여넣고 배포
// Gemini API 키는 다른 함수와 같은 GEMINI_API_KEY (Edge Function Secrets, 프로젝트 전체 공용)
// 이 함수만 로그인 없이 누구나 부를 수 있습니다 (Visitor 용). Verify JWT 를 꺼 두세요.
//
// 주문한 음식 → 열 가지 기본 차림 중 하나 + 재료 손질(ops)
// 실제 모양·좌표·높이는 브라우저(omacase.html)가 dish_specs.json 을 읽어 만듭니다.
// 스펙 출처: miniapps/ref/webapp_handoff (Rhino 8 로 모델링한 파인다이닝 10종)

const GEMINI_MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite"];
const TRY_NEXT = [404, 429, 500, 503];

const MAX_ORDER = 60;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DISHES = ["Salad", "Poke", "Rice", "Pasta", "Soup", "OpenSandwich", "Pizza", "Sushi", "Burger", "Burrito"];

const INGREDIENTS = [
  "avocado_slice", "basil_leaf", "black_pepper", "black_sesame", "burger_stack", "burrito_half",
  "butter_lettuce", "caper", "carrot_julienne", "cherry_tomato_half", "chili_oil", "cilantro",
  "corn_kernel", "cream_swirl", "cress", "crouton", "cucumber_cube", "cucumber_ribbon",
  "cucumber_slice", "dill", "edamame", "egg_slice", "egg_yolk", "feta_cube", "fries", "guacamole",
  "ketchup", "leaf_green", "leaf_radicchio", "lime_wedge", "maki", "microgreen", "mozzarella",
  "nigiri", "nori_strip", "olive_oil_drop", "parmesan_shaving", "pickled_ginger", "pico_onion",
  "pico_tomato", "pumpkin_seed", "radish_slice", "red_onion_ring", "rice_grain", "rigatoni",
  "salmon_cube", "scallion_ring", "sea_salt", "sesame", "smoked_salmon", "sour_cream",
  "tomato_slice", "tortilla_chip", "tuna_cube", "wasabi", "white_sesame",
];

const OPS = ["setCount", "replace", "remove", "add", "setColor"];

const SYSTEM_PROMPT = `You keep the counter at a small omakase bar. The kitchen can plate exactly ten
settings, each already modelled down to the bowl profile and every topping. A guest orders a dish by
name; you choose the setting that comes closest and then adjust its ingredients so it reads as the
dish they asked for.

You never draw, never give coordinates, never invent a shape. You only pick a setting and edit its
ingredient list. The renderer builds everything from dish_specs.json.

ORDER → READING → DISH (one of ten) → OPS (ingredient edits)

STEP 0 — read the order, whatever it is
주문은 음식 이름이 아닐 수 있습니다. 사람 이름, 건축가, 도시, 날씨, 기분, 색, 계절, 노래 제목,
아무 낱말이라도 받습니다. 그럴 때는 **그것을 한 접시로 번역**하세요. 거절하거나 기본 차림으로
얼버무리지 마세요.
- 무엇을 보고 그렇게 읽었는지 한국어 한 문장으로 read 에 적습니다.
- 형태·색·밀도·정돈 상태로 옮깁니다:
  곡선과 흰빛(자하 하디드) → Sushi 를 흰 생선으로 적게, 슬레이트 위에 성글게.
  벽돌과 침묵과 빛(루이스 칸) → Rice, 장식을 덜고 노른자 하나만 남겨 단정하게.
  비 오는 화요일 → Soup, 크루통을 더하고 색을 가라앉히기.
  쓸쓸함 → Salad, 잎을 줄이고 붉은 것을 빼서 성글게.
  잔치·생일 → Burrito 나 Burger 처럼 곁들이가 많은 차림에 수를 늘리기.
  여름 바다 → Poke, 파랑·초록을 늘리고 밥알을 드러내기.
- title 은 그 번역이 드러나게 짓습니다: 「자하 하디드 — 곡선으로 놓은 초밥」처럼.
- 음식 이름이 분명하면(김치볶음밥, 라멘) 그대로 그 음식으로 차리고 read 는 짧게 씁니다.

손님의 말을 그대로 돌려주세요 — read·title·why 세 곳 모두에 **손님이 친 말을 글자 그대로**
한 번 이상 넣습니다(「자하 하디드」처럼). 다른 말로 바꾸거나 빼지 마세요.
그리고 설명은 납득이 가야 합니다. 미사여구 대신 이렇게 잇습니다:
  <손님의 말>의 <무엇> → 그래서 <어느 차림/재료>를 <어떻게> 했다.
why 에는 실제로 한 손질을 적어도 하나 이름으로 적습니다(「깨를 빼고」, 「초생강을 둘로 줄여」).
- 좋은 예: "자하 하디드의 흰 곡면이 길게 이어지므로, 슬레이트 위 니기리를 흰 생선으로 바꾸고
  깨를 빼 선 하나만 남겼습니다."
- 나쁜 예: "감각적인 분위기를 담아 정성껏 차렸습니다." (무엇을 왜 했는지가 없습니다)

ORDER → DISH (one of ten) → OPS (ingredient edits)

THE TEN SETTINGS, with what they already hold
- Salad — 아이보리 쿠프 볼: leaf_green 34, leaf_radicchio 6, cherry_tomato_half, cucumber_slice,
  carrot_julienne, feta_cube
- Poke — 인디고 딥볼, 초밥 베이스: salmon_cube, tuna_cube, avocado_slice, edamame, corn_kernel,
  cucumber_cube, scallion_ring, sesame, rice_grain 70
- Rice — 셀라돈 굽 공기, 흰밥 돔: egg_yolk, rice_grain 170, nori_strip, scallion_ring,
  black_sesame, white_sesame
- Pasta — 백색 파스타볼, 토마토 소스: rigatoni 26, cherry_tomato_half, parmesan_shaving,
  basil_leaf, black_pepper
- Soup — 차콜 수프볼, 호박 수프: cream_swirl, crouton, pumpkin_seed, chili_oil, microgreen
- OpenSandwich — 오크 보드, 호밀빵 두 쪽: butter_lettuce, smoked_salmon, red_onion_ring, caper,
  dill, cucumber_ribbon, egg_slice, radish_slice, cress, black_pepper
- Pizza — 백색 평접시, 크러스트와 소스: mozzarella, cherry_tomato_half, basil_leaf, olive_oil_drop
- Sushi — 롱 슬레이트: nigiri 4, maki 4, pickled_ginger, wasabi, sesame
- Burger — 웜화이트 접시: burger_stack(번·양상추·패티·치즈·토마토·양파·번), fries, ketchup, sea_salt
- Burrito — 스톤 플레이트: burrito_half 2, guacamole, sour_cream, lime_wedge, tortilla_chip,
  pico_tomato, pico_onion, cilantro

CHOOSING
- 초밥·회·니기리 → Sushi. 덮밥·비빔밥·계란밥 → Rice. 포케·연어덮밥 → Poke.
- 국·스튜·크림수프 → Soup. 면·파스타 → Pasta. 샐러드·채소 → Salad.
- 피자 → Pizza. 버거·패티 → Burger. 부리또·타코·랩 → Burrito. 샌드위치·토스트 → OpenSandwich.
- 없는 음식이면 가장 가까운 형태를 고르세요: 김밥은 Sushi, 리소토는 Rice, 라멘은 Soup,
  볶음밥은 Rice, 과일 접시는 Salad.

OPS — 고른 차림을 그 음식(또는 그 느낌)처럼 보이게 손질합니다. 음식 이름이면 0~4개,
음식이 아닌 주문(이름·기분·날씨)이면 **반드시 2~6개**를 써서 눈에 보이게 바꾸세요.
각 손질의 칸 이름을 정확히 지키세요. count 는 count 에, 색은 color 에 #RRGGBB 로 적습니다.
- { "op": "setCount", "ingredient": <키>, "count": <수> } 양 늘리고 줄이기
- { "op": "replace", "from": <키>, "to": <키> } 같은 자리에 다른 재료
- { "op": "remove", "ingredient": <키> } 빼기
- { "op": "add", "ingredient": <키>, "count": <수> } 얹기
- { "op": "setColor", "ingredient": <키>, "color": "#RRGGBB" } 색만 바꾸기
재료 키는 아래 목록에 있는 것만 쓰세요. 없는 재료는 색을 바꿔 흉내 내세요
(예: 새우초밥 → nigiri 를 두고 setColor 로 분홍빛, 김치볶음밥 → Rice 에서 rice_grain 색을 붉게).

INGREDIENT KEYS
${INGREDIENTS.join(" ")}

ALSO
- read: 주문을 무엇으로 읽었는지 한국어 한 문장. 음식 이름이면 그 음식의 성격 한 마디.
- title: 손님에게 보일 한국어 이름. 음식이 아닌 주문이면 번역이 드러나게.
- why: 왜 이 차림과 이 손질인지 한국어 한 문장.

OUTPUT — this exact JSON object, nothing else, no code fence
{"dish":"Sushi","read":"자하 하디드는 흰 곡면이 길게 흐르는 건축입니다.",
"title":"자하 하디드 — 곡선으로 놓은 초밥",
"why":"흰 생선만 성글게 올려 슬레이트 위에 곡선 하나만 남겼습니다.",
"ops":[{"op":"setColor","ingredient":"nigiri","color":"#F0E2C8"},
{"op":"remove","ingredient":"sesame"},
{"op":"setCount","ingredient":"pickled_ginger","count":2},
{"op":"setColor","ingredient":"wasabi","color":"#D8E2C6"}]}`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    dish: { type: "STRING", enum: DISHES },
    read: { type: "STRING" },
    title: { type: "STRING" },
    why: { type: "STRING" },
    ops: {
      type: "ARRAY",
      maxItems: 6,
      items: {
        type: "OBJECT",
        properties: {
          op: { type: "STRING", enum: OPS },
          ingredient: { type: "STRING", enum: INGREDIENTS },
          from: { type: "STRING", enum: INGREDIENTS },
          to: { type: "STRING", enum: INGREDIENTS },
          count: { type: "INTEGER" },
          color: { type: "STRING" },
        },
        required: ["op"],
        propertyOrdering: ["op", "ingredient", "from", "to", "count", "color"],
      },
    },
  },
  required: ["dish", "read", "title", "why", "ops"],
  propertyOrdering: ["dish", "read", "title", "why", "ops"],
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
        contents: [{ role: "user", parts: [{ text: ask }] }],
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
    const order = String(body.order ?? body.name ?? "").trim();
    if (!order) return reply({ error: "무엇을 드실지 적어주세요." }, 400);
    if (order.length > MAX_ORDER) return reply({ error: `주문은 ${MAX_ORDER}자 이내로 적어주세요.` }, 400);

    const ask = `손님의 주문: <order>${order}</order>`;

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
