// Blind Date — Supabase Edge Function (이름: blind-date)
// Supabase 대시보드 > Edge Functions > Deploy a new function > Via Editor 에 붙여넣고 배포
// Gemini API 키는 다른 함수와 같은 GEMINI_API_KEY (Edge Function Secrets, 프로젝트 전체 공용)
// 이 함수도 로그인 없이 누구나 부를 수 있습니다 (Visitor 용). Verify JWT 를 꺼 두세요.
//
// 작성자 정보 + 결말 → 근황토크용 가짜 소개팅 썰(10줄 이내) + 상대 프로필 + 몽타주 수치
// 몽타주(4방향 3D)는 브라우저(blind-date.html)가 만듭니다. 서버는 정해진 어휘와 0~1 수치만 고릅니다.
//
// 토큰 아끼기: 짧은 프롬프트 · 스트리밍 없음 · 생각(thinking) 끔 · 출력 상한 · 가벼운 모델부터

const GEMINI_MODELS = ["gemini-3.1-flash-lite", "gemini-2.5-flash-lite", "gemini-3.5-flash-lite", "gemini-3.5-flash"];
const TRY_NEXT = [404, 429, 500, 503];
const MAX_OUT = 1100;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OUTCOMES: Record<string, string> = {
  success: "애프터 성공, 다음 약속 잡음",
  reject: "내가 애프터 거절",
  rejected: "애프터 신청했다가 차임",
  fizzle: "연락이 흐지부지 끊김",
};

// 매번 같은 동네·메뉴·주선자만 나오지 않게, 후보를 요청마다 무작위로 좁혀 보냅니다.
const AREAS = [
  "성수", "연남", "망원", "을지로", "합정", "서촌", "익선동", "문래", "삼각지", "신용산", "해방촌",
  "압구정로데오", "한남", "건대", "잠실 송리단길", "판교", "광교", "수원 행궁동", "부산 전포", "대구 동성로",
];
const FOODS = [
  "이탈리안 파스타", "와인바", "이자카야", "브런치", "한우 오마카세", "텐동", "쌀국수", "타코",
  "양갈비", "중식 코스", "곱창", "비건 레스토랑", "프렌치 비스트로", "수제버거", "솥밥", "스페인 타파스",
];
const LINKS = [
  "회사 동기의 대학 동기", "헬스장 트레이너의 사촌", "전 직장 선배의 와이프 친구", "필라테스 강사님 지인",
  "사촌 누나 회사 후배", "동호회 형의 고등학교 친구", "단골 미용실 원장님 조카", "엄마 친구 딸의 직장 동료",
];

const FACES = ["oval", "round", "square", "long", "heart"];
const HAIRS = ["buzz", "short", "two_block", "perm", "slick", "bob", "long", "wave", "ponytail", "bun"];
const HAIR_COLORS = ["black", "dark_brown", "brown", "ash", "blonde"];
const GLASSES = ["none", "round", "square"];
const BUILDS = ["slim", "average", "athletic", "chubby"];
const OUTFITS = ["dandy", "casual", "hiphop"];
const TONES = ["navy", "black", "beige", "grey", "white", "olive", "burgundy"];

const SYSTEM_PROMPT = `너는 친구들 근황토크용 '그럴듯한 가짜 소개팅 썰'을 쓴다. 작성자가 친구들에게 1인칭 반말 구어체로 말하듯("~했잖아", "~더라").
- 주선자: 듣는 친구들이 확인 못 할 먼 사이. 이름 없이 관계로만(후보 참고).
- 장소: 후보 동네 하나, 메뉴와 1인 가격대, 가게 분위기.
- 상대(p): 가명, 나이, 키(cm), 직업, 출신 학교. 외모·성격·매너를 구체적으로. 현실적이되 웃긴 디테일 하나.
- 대화: 실제 오간 대사 2개 이상을 따옴표로. 상대 MBTI가 드러나는 말투.
- 너무 완벽하거나 과장되면 들킨다. 사소하고 생활감 있게.
- 결말은 주어진 결과를 그대로. 유명인·실존 인물 금지, 비하·성적 표현 금지.
- s: 6~10줄, 줄마다 60자 안팎. t: 썰 제목 18자 이내.
- a(몽타주)는 썰 속 외모와 맞게. 0~1 수치(eye 눈크기, eyeY 눈높이, gap 눈간격, nose 코크기, mouth 입크기, mouthY 입높이, limb 팔다리길이).
JSON만: {"t":"","p":{"name":"","age":0,"h":0,"job":"","school":"","mbti":""},"a":{"face":"","skin":0,"hair":"","hc":"","glasses":"","eye":0,"eyeY":0,"gap":0,"nose":0,"mouth":0,"mouthY":0,"build":"","limb":0,"outfit":"","tone":""},"s":[""]}`;

const num01 = { type: "NUMBER" };
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    t: { type: "STRING" },
    p: {
      type: "OBJECT",
      properties: {
        name: { type: "STRING" },
        age: { type: "INTEGER" },
        h: { type: "INTEGER" },
        job: { type: "STRING" },
        school: { type: "STRING" },
        mbti: { type: "STRING" },
      },
      required: ["name", "age", "h", "job", "school", "mbti"],
    },
    a: {
      type: "OBJECT",
      properties: {
        face: { type: "STRING", enum: FACES },
        skin: { type: "INTEGER" },
        hair: { type: "STRING", enum: HAIRS },
        hc: { type: "STRING", enum: HAIR_COLORS },
        glasses: { type: "STRING", enum: GLASSES },
        eye: num01, eyeY: num01, gap: num01, nose: num01, mouth: num01, mouthY: num01,
        build: { type: "STRING", enum: BUILDS },
        limb: num01,
        outfit: { type: "STRING", enum: OUTFITS },
        tone: { type: "STRING", enum: TONES },
      },
      required: ["face", "skin", "hair", "hc", "glasses", "eye", "eyeY", "gap", "nose", "mouth", "mouthY",
        "build", "limb", "outfit", "tone"],
    },
    s: { type: "ARRAY", maxItems: 10, items: { type: "STRING" } },
  },
  required: ["t", "p", "a", "s"],
};

function sample<T>(arr: readonly T[], n: number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

function reply(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

const clip = (v: unknown, n: number) => String(v ?? "").replace(/[<>]/g, "").trim().slice(0, n);

// 모델마다 생각 끄는 방법이 다릅니다. 거절당하면(400) 생각 설정 → 스키마 순서로 하나씩 뺍니다.
function thinkingFor(model: string) {
  return model.startsWith("gemini-2.5") ? { thinkingBudget: 0 } : { thinkingLevel: "minimal" };
}

function askGemini(model: string, apiKey: string, ask: string, step: number) {
  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
    temperature: 1.1,
    maxOutputTokens: MAX_OUT,
  };
  if (step < 2) generationConfig.responseSchema = RESPONSE_SCHEMA;
  if (step < 1) generationConfig.thinkingConfig = thinkingFor(model);

  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: ask }] }],
      generationConfig,
    }),
  });
}

function geminiMessage(body: string) {
  try {
    const j = JSON.parse(body);
    return String(j.error?.message ?? "").replace(/\s+/g, " ").slice(0, 300);
  } catch {
    return body.replace(/\s+/g, " ").slice(0, 300);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return reply({ ok: true });

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return reply({ error: "GEMINI_API_KEY 미설정 (Edge Function Secrets)" }, 500);

  try {
    const body = await req.json().catch(() => ({}));
    const name = clip(body.name, 20);
    const age = Math.round(Number(body.age));
    const gender = body.gender === "f" ? "여" : body.gender === "m" ? "남" : "";
    const job = clip(body.job, 30);
    const mbti = clip(body.mbti, 4).toUpperCase();
    const outcome = OUTCOMES[String(body.outcome)] ? String(body.outcome) : "";
    const ending = clip(body.ending, 60);
    const target = body.target === "f" || body.target === "m" ? body.target : (gender === "남" ? "f" : "m");

    if (!name) return reply({ error: "이름을 적어주세요." }, 400);
    if (!(age >= 20 && age <= 60)) return reply({ error: "나이는 20~60 사이로 적어주세요." }, 400);
    if (!gender) return reply({ error: "성별을 골라주세요." }, 400);
    if (!job) return reply({ error: "직업을 적어주세요." }, 400);
    if (!/^[EI][NS][TF][JP]$/.test(mbti)) return reply({ error: "MBTI 4글자를 확인해주세요." }, 400);
    if (!outcome) return reply({ error: "결말을 골라주세요." }, 400);

    const ask = [
      `작성자: <me>${name}, ${age}세 ${gender}, ${job}, ${mbti}</me>`,
      `상대 성별: ${target === "f" ? "여" : "남"}, 나이는 작성자와 ±4세`,
      `결말: ${OUTCOMES[outcome]}${ending ? ` / ${ending}` : ""}`,
      `동네 후보: ${sample(AREAS, 3).join(", ")} · 메뉴 후보: ${sample(FOODS, 3).join(", ")}`,
      `주선자 후보: ${sample(LINKS, 2).join(", ")}`,
      `skin 0(밝음)~5(어두움). 씨앗 ${Math.random().toString(36).slice(2, 8)}`,
    ].join("\n");

    let res: Response | undefined;
    let detail = "";
    let model = "";
    let step = 0;

    search:
    for (model of GEMINI_MODELS) {
      while (step < 3) {
        res = await askGemini(model, apiKey, ask, step);
        if (res.ok) break search;

        const status = res.status;
        detail = geminiMessage(await res.text().catch(() => ""));
        if (status === 400) {
          console.warn(`${model} 400 (단계 ${step}): ${detail}`);
          step += 1;
          continue;
        }
        console.warn(`${model} ${status}: ${detail}`);
        if (TRY_NEXT.includes(status)) break;
        break search;
      }
      if (step >= 3) break;
    }

    if (!res!.ok) {
      const status = res!.status;
      if (TRY_NEXT.includes(status)) {
        return reply({ error: `주선자가 바쁩니다. 잠시 후 다시 눌러 주세요. (${status})` }, 503);
      }
      return reply({ error: `Gemini 오류 ${status}: ${detail}` }, 502);
    }

    const data = await res!.json();
    const cand = data.candidates?.[0];
    const text = (cand?.content?.parts ?? [])
      .filter((p: { text?: string; thought?: boolean }) => p.text && !p.thought)
      .map((p: { text: string }) => p.text)
      .join("");
    const u = data.usageMetadata ?? {};
    console.log(`${model} 단계 ${step} · 입력 ${u.promptTokenCount} · 출력 ${u.candidatesTokenCount} · 합계 ${u.totalTokenCount}`);

    let story;
    try {
      story = JSON.parse(text.replace(/^[^{]*/, "").replace(/[^}]*$/, ""));
    } catch {
      const why = cand?.finishReason === "MAX_TOKENS" ? "썰이 너무 길어졌습니다" : "썰이 엉켰습니다";
      return reply({ error: `${why}. 다시 눌러 주세요.` }, 502);
    }
    if (!Array.isArray(story?.s) || !story.s.length) return reply({ error: "빈 썰이 돌아왔습니다. 다시 눌러 주세요." }, 502);
    story.s = story.s.map((l: unknown) => String(l)).filter(Boolean).slice(0, 10);
    story.target = target;

    return reply(story);
  } catch (e) {
    console.error(e);
    return reply({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
