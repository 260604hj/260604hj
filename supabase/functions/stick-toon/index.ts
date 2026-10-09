// 스틱 툰 — Supabase Edge Function (이름: stick-toon)
// Supabase 대시보드 > Edge Functions > Deploy a new function > Via Editor 에 붙여넣고 배포
// Gemini API 키는 다른 함수와 같은 GEMINI_API_KEY (Edge Function Secrets, 프로젝트 전체 공용)
// 무료 등급은 보낸 내용이 Google 제품 개선에 쓰일 수 있음.
//
// 줄거리 → 10페이지 스토리보드 JSON (장소·자리·자세·감정·샷·말풍선)
// 그림은 그리지 않음. 브라우저(stick-toon.html)가 이 JSON 으로 3D 세트와 막대 인형을 찍어 컷을 만듦.
// 장소와 자리 목록(catalog)은 브라우저가 함께 보냄 → 여기서 그 목록 밖의 값은 모두 바로잡음.

const GEMINI_MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite"];
const TRY_NEXT = [404, 429, 500, 503];

const PAGES = 10;
const MAX_PLOT = 300;
const MAX_CATALOG = 8000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

const EMOS = ["calm", "joy", "sad", "angry", "fear"];
const CATS = ["sit", "lie", "stand", "walk", "run"];
const SIZES = ["wide", "normal", "tall"];
const TIMES = ["morning", "day", "evening", "night"];
const SHOTS = ["wide", "two", "full", "bust", "close"];
const ANGLES = ["front", "three", "side", "back", "ots"];
const KINDS = ["narration", "speech", "thought", "text", "sfx"];
const FXS = ["none", "focus", "gloom", "sparkle"];
const PROPS = ["phone", "cup"];
const HAIRS = ["none", "short", "long", "bob", "bun", "ponytail"];
const BUILDS = ["slim", "normal", "broad"];
const SLOT_IDS = ["A", "B", "C", "D", "E", "F"];
const LOCAL_POSES = ["p:sitphone", "p:standphone"];

type Slot = { id: string; type: string; label: string };
type Loc = { id: string; ko: string; slots: Slot[] };
type Catalog = { locations: Loc[]; extras: string[] };

// 자리 유형마다 쓸 수 있는 자세
function allowed(type: string, pose: string) {
  const cat = pose.split(":")[0];
  if (type === "sit") return cat === "sit" || pose === "p:sitphone";
  if (type === "lie") return cat === "lie";
  if (type === "stand") return cat === "stand" || cat === "x" || pose === "p:standphone";
  if (type === "walk") return ["walk", "run", "stand", "x"].includes(cat) || pose === "p:standphone";
  return false;
}
const BASE_CAT: Record<string, string> = { sit: "sit", lie: "lie", stand: "stand", walk: "walk" };

// 브라우저가 보낸 목록 확인 (모양이 이상하거나 너무 크면 거절)
function readCatalog(raw: unknown): Catalog | null {
  if (!raw || typeof raw !== "object" || JSON.stringify(raw).length > MAX_CATALOG) return null;
  const c = raw as Record<string, unknown>;
  const word = (v: unknown, n: number) => String(v ?? "").replace(/[<>`]/g, "").slice(0, n);
  const locations = (Array.isArray(c.locations) ? c.locations : []).slice(0, 16).map((l: Record<string, unknown>) => ({
    id: word(l.id, 20).replace(/[^a-z0-9_]/g, ""),
    ko: word(l.ko, 12),
    slots: (Array.isArray(l.slots) ? l.slots : []).slice(0, 6).map((s: Record<string, unknown>) => ({
      id: word(s.id, 1).toUpperCase(),
      type: word(s.type, 6),
      label: word(s.label, 20),
    })).filter((s: Slot) => SLOT_IDS.includes(s.id) && BASE_CAT[s.type]),
  })).filter((l: Loc) => l.id && l.slots.length);
  const extras = (Array.isArray(c.extras) ? c.extras : []).slice(0, 12).map((e: unknown) => word(e, 16)).filter(Boolean);
  return locations.length ? { locations, extras } : null;
}

function poseList(cat: Catalog) {
  const list = [];
  for (const c of CATS) for (const e of EMOS) list.push(`${c}:${e}`);
  for (const x of cat.extras) list.push(`x:${x}`);
  return list.concat(LOCAL_POSES);
}

function systemPrompt(cat: Catalog) {
  return `한두 문장의 줄거리를 받아 세로 스크롤 웹툰 ${PAGES}페이지의 스토리보드를 JSON으로 만듭니다. 줄거리는 <plot> 안에 있습니다.
그림은 정해진 흑백 3D 세트와 막대 인형이 그립니다. 아래 목록에 있는 값만 쓰세요.

[인물] characters: 2~4명.
- id: 영문 소문자 한 단어(예: jieun). name: 한국어 이름. desc: 나이·직업·인상 한 줄.
- body_hint: 줄거리에 어울리는 체형. height(cm, 100~200), heads(등신, 4~9.5, 아이는 낮게), build(slim|normal|broad).
- hair: none|short|long|bob|bun|ponytail. 인물끼리 겹치지 않게 골라 누가 누군지 구별되게.

[페이지] pages: 정확히 ${PAGES}개. summary(한국어 한 줄), panels 1~3개.
처음(상황) → 전개(갈등) → 전환 → 마무리가 ${PAGES}페이지에 고르게 나뉘게. 감정이 터지는 순간은 size tall + shot close.

[컷] panel
- size: wide(설정샷, 장소가 바뀔 때) | normal | tall
- location과 자리(slot). 자리 유형(sit 앉기, lie 눕기, stand 서기, walk 걷기)에 맞는 자세만:
${cat.locations.map((l) => `  ${l.id}(${l.ko}): ` + l.slots.map((s) => `${s.id}=${s.label}(${s.type})`).join(", ")).join("\n")}
- time: morning | day | evening | night (이야기 속 시간에 맞게)
- cast: 이 컷에 보이는 인물. { who, slot, pose, emo?, turn?, step?, prop? }
  한 컷 안에서 같은 자리를 두 명이 쓰지 않기. 같은 장면이 이어지면 같은 인물은 같은 자리에.
  pose = 자세:감정. 자세는 sit|lie|stand|walk|run, 감정은 calm|joy|sad|angry|fear.
         서기(stand)·걷기(walk) 자리에서는 ${cat.extras.map((x) => `x:${x}`).join(" | ")} 도 가능.
         휴대폰을 보는 장면은 p:sitphone(앉기 자리) 또는 p:standphone(서기 자리), prop은 phone.
  emo: 자세는 그대로 두고 표정만 바꿀 때. turn: 자리 방향에서 몸을 돌리는 각도(도, -180~180).
  step: 바라보는 쪽으로 옮기는 거리(mm, 0~6000). prop: phone | cup.
- shot: wide(장소 전체) | two(두 사람) | full(전신) | bust(상반신) | close(얼굴)
- camera: { on: 중심 인물 id, with: two샷 상대 id, angle: front|three|side|back|ots, side: left|right, height: eye|high|low, from: ots일 때 어깨 너머 인물 id }
- bubbles: 최대 3개. { kind, who?, text }
  narration(내레이션 상자) | speech(말) | thought(속마음) | text(휴대폰 메시지, who=보낸 사람) | sfx(효과음 1~3자)
  한 풍선은 30자 이내의 자연스러운 한국어.
- fx: none | focus(집중선, 놀람·결심) | gloom(우울) | sparkle(설렘·기쁨)

[제목] title: 한국어 짧은 제목.`;
}

function responseSchema(cat: Catalog) {
  const S = (e?: string[]) => (e ? { type: "STRING", enum: e } : { type: "STRING" });
  return {
    type: "OBJECT",
    properties: {
      title: S(),
      characters: {
        type: "ARRAY", minItems: 1, maxItems: 4,
        items: {
          type: "OBJECT",
          properties: {
            id: S(), name: S(), desc: S(), hair: S(HAIRS),
            body_hint: {
              type: "OBJECT",
              properties: { height: { type: "INTEGER" }, heads: { type: "NUMBER" }, build: S(BUILDS) },
              required: ["height", "heads", "build"],
            },
          },
          required: ["id", "name", "desc", "hair", "body_hint"],
        },
      },
      pages: {
        type: "ARRAY", minItems: PAGES, maxItems: PAGES,
        items: {
          type: "OBJECT",
          properties: {
            summary: S(),
            panels: {
              type: "ARRAY", minItems: 1, maxItems: 3,
              items: {
                type: "OBJECT",
                properties: {
                  size: S(SIZES), location: S(cat.locations.map((l) => l.id)), time: S(TIMES), shot: S(SHOTS),
                  camera: {
                    type: "OBJECT",
                    properties: { on: S(), with: S(), angle: S(ANGLES), side: S(["left", "right"]), height: S(["eye", "high", "low"]), from: S() },
                  },
                  cast: {
                    type: "ARRAY", maxItems: 4,
                    items: {
                      type: "OBJECT",
                      properties: {
                        who: S(), slot: S(SLOT_IDS), pose: S(poseList(cat)), emo: S(EMOS),
                        turn: { type: "INTEGER" }, step: { type: "INTEGER" }, prop: S(PROPS),
                      },
                      required: ["who", "slot", "pose"],
                    },
                  },
                  bubbles: {
                    type: "ARRAY", maxItems: 3,
                    items: { type: "OBJECT", properties: { kind: S(KINDS), who: S(), text: S() }, required: ["kind", "text"] },
                  },
                  fx: S(FXS),
                },
                required: ["size", "location", "time", "shot", "cast", "bubbles", "fx"],
              },
            },
          },
          required: ["summary", "panels"],
        },
      },
    },
    required: ["title", "characters", "pages"],
  };
}

// ── Gemini 가 보낸 JSON 을 그릴 수 있는 값으로만 정리 ─────────────────────
const pick = (v: unknown, list: string[], fallback: string) => (list.includes(String(v)) ? String(v) : fallback);
const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const text = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export function cleanStory(raw: Record<string, unknown>, cat: Catalog) {
  const poses = new Set(poseList(cat));
  const loc = Object.fromEntries(cat.locations.map((l) => [l.id, l]));

  // 인물
  const ids = new Set<string>();
  const characters = (Array.isArray(raw.characters) ? raw.characters : []).slice(0, 4).map((c: Record<string, unknown>, i: number) => {
    let id = String(c.id ?? "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 12) || `c${i + 1}`;
    while (ids.has(id)) id += "x";
    ids.add(id);
    const b = (c.body_hint ?? {}) as Record<string, unknown>;
    return {
      id,
      name: text(c.name, 10) || `인물${i + 1}`,
      desc: text(c.desc, 40),
      hair: pick(c.hair, HAIRS, "short"),
      body_hint: {
        height: Math.round(clamp(b.height, 100, 200, 165)),
        heads: Math.round(clamp(b.heads, 4, 9.5, 7) * 10) / 10,
        build: pick(b.build, BUILDS, "normal"),
      },
    };
  });
  if (!characters.length) throw new Error("등장인물을 받지 못했습니다");
  const who = (v: unknown) => (ids.has(String(v)) ? String(v) : "");

  // 페이지 · 컷
  let lastLoc = cat.locations[0].id;
  const pages = (Array.isArray(raw.pages) ? raw.pages : []).slice(0, PAGES).map((pg: Record<string, unknown>) => {
    const panels = (Array.isArray(pg.panels) ? pg.panels : []).slice(0, 3).map((p: Record<string, unknown>) => {
      const location = loc[String(p.location)] ? String(p.location) : lastLoc;
      lastLoc = location;
      const slots = loc[location].slots;

      // 배역: 아는 인물만, 한 자리에 한 명, 자리 유형에 맞는 자세로
      const used = new Set<string>(), seen = new Set<string>();
      const cast = (Array.isArray(p.cast) ? p.cast : []).slice(0, 4).map((a: Record<string, unknown>) => {
        const w = who(a.who);
        if (!w || seen.has(w)) return null;
        let slot = slots.find((s) => s.id === String(a.slot) && !used.has(s.id));
        let pose = poses.has(String(a.pose)) ? String(a.pose) : "stand:calm";
        if (!slot) slot = slots.find((s) => !used.has(s.id) && allowed(s.type, pose)) || slots.find((s) => !used.has(s.id));
        if (!slot) return null;
        if (!allowed(slot.type, pose)) {
          const emo = pose.split(":")[1];
          pose = `${BASE_CAT[slot.type]}:${EMOS.includes(emo) ? emo : "calm"}`;
        }
        used.add(slot.id); seen.add(w);
        const out: Record<string, unknown> = { who: w, slot: slot.id, pose };
        if (EMOS.includes(String(a.emo))) out.emo = String(a.emo);
        const turn = Math.round(clamp(a.turn, -180, 180, 0));
        if (turn) out.turn = turn;
        const step = Math.round(clamp(a.step, 0, 6000, 0));
        if (step) out.step = step;
        if (PROPS.includes(String(a.prop))) out.prop = String(a.prop);
        return out;
      }).filter(Boolean) as Record<string, unknown>[];
      const inPanel = new Set(cast.map((a) => a.who as string));

      let shot = pick(p.shot, SHOTS, "bust");
      if (!cast.length) shot = "wide";
      if (shot === "two" && cast.length < 2) shot = "bust";
      const c = (p.camera ?? {}) as Record<string, unknown>;
      const inCast = (v: unknown) => (inPanel.has(String(v)) ? String(v) : "");
      const on = inCast(c.on) || (cast[0]?.who as string) || "";
      const camera: Record<string, string> = {};
      if (shot !== "wide") {
        camera.on = on;
        camera.angle = pick(c.angle, ANGLES, "three");
        if (camera.angle === "ots") {
          const from = inCast(c.from) && c.from !== on ? String(c.from) : (cast.find((a) => a.who !== on)?.who as string) || "";
          if (from) camera.from = from; else camera.angle = "three";
        }
        if (shot === "two") camera.with = inCast(c.with) && c.with !== on ? String(c.with) : (cast.find((a) => a.who !== on)?.who as string);
        if (["left", "right"].includes(String(c.side))) camera.side = String(c.side);
        if (["eye", "high", "low"].includes(String(c.height))) camera.height = String(c.height);
      }

      const bubbles = (Array.isArray(p.bubbles) ? p.bubbles : []).slice(0, 3).map((b: Record<string, unknown>) => {
        let kind = pick(b.kind, KINDS, "narration");
        const t = text(b.text, kind === "sfx" ? 4 : 40);
        if (!t) return null;
        const w = who(b.who);
        // 말·속마음·효과음은 이 컷에 보이는 사람, 메시지는 등장인물 누구든
        if (kind !== "narration" && !(kind === "text" ? w : inPanel.has(w))) kind = kind === "sfx" ? "sfx" : "narration";
        const out: Record<string, string> = { kind, text: t };
        if (kind !== "narration" && w) out.who = w;
        return out;
      }).filter(Boolean);

      return {
        size: pick(p.size, SIZES, "normal"), location, time: pick(p.time, TIMES, "day"),
        shot, camera, cast, bubbles, fx: pick(p.fx, FXS, "none"),
      };
    });
    return { summary: text(pg.summary, 40), panels };
  }).filter((pg: { panels: unknown[] }) => pg.panels.length);

  if (pages.length < PAGES) throw new Error(`${pages.length}페이지밖에 받지 못했습니다`);
  return { title: text(raw.title, 40) || "제목 없음", characters, pages };
}

function reply(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

async function currentUser(req: Request) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: req.headers.get("apikey") ?? "", Authorization: req.headers.get("Authorization") ?? "" },
  });
  return res.ok ? await res.json() : null;
}

async function askGemini(model: string, apiKey: string, plot: string, cat: Catalog) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt(cat) }] },
      contents: [{ role: "user", parts: [{ text: `<plot>${plot}</plot>` }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: responseSchema(cat), maxOutputTokens: 16000 },
    }),
  });
  return { res, data: await res.json() };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return reply({ ok: true });

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return reply({ error: "GEMINI_API_KEY 미설정 (Edge Function Secrets)" }, 500);

  try {
    // 1. 로그인한 사람만 (무료 사용량을 모두가 같이 쓰므로)
    if (!(await currentUser(req))) return reply({ error: "로그인이 필요합니다." }, 401);

    // 2. 줄거리와 장소 목록 확인
    const body = await req.json().catch(() => ({}));
    const plot = String(body.plot ?? "").trim();
    if (!plot) return reply({ error: "줄거리를 입력하세요." }, 400);
    if (plot.length > MAX_PLOT) return reply({ error: `줄거리는 ${MAX_PLOT}자 이내로 써주세요.` }, 400);
    const cat = readCatalog(body.catalog);
    if (!cat) return reply({ error: "장소 목록이 비었거나 너무 큽니다." }, 400);

    // 3. Gemini 에게 스토리보드 요청 (붐비면 다음 모델로)
    let model = "", res: Response | undefined, data;
    for (model of GEMINI_MODELS) {
      ({ res, data } = await askGemini(model, apiKey, plot, cat));
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

    // 4. 받은 JSON 을 꺼내서 정리
    const candidate = data.candidates?.[0];
    const raw = (candidate?.content?.parts ?? [])
      .filter((part: { text?: string; thought?: boolean }) => part.text && !part.thought)
      .map((part: { text: string }) => part.text)
      .join("");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return reply({ error: `스토리보드를 읽지 못했습니다 (${candidate?.finishReason ?? "응답 없음"}). 다시 시도하세요.` }, 502);
    }
    try {
      return reply({ ...cleanStory(parsed, cat), model });
    } catch (e) {
      return reply({ error: `${e instanceof Error ? e.message : e}. 다시 시도하세요.` }, 502);
    }
  } catch (e) {
    console.error(e);
    return reply({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
