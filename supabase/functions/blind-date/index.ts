// Blind Date — Supabase Edge Function (이름: blind-date)
// Supabase 대시보드 > Edge Functions > Deploy a new function > Via Editor 에 붙여넣고 배포
// Gemini API 키는 다른 함수와 같은 GEMINI_API_KEY (Edge Function Secrets, 프로젝트 전체 공용)
// 이 함수도 로그인 없이 누구나 부를 수 있습니다 (Visitor 용). Verify JWT 를 꺼 두세요.
//
// 작성자 정보 + 결말 + 도파민(상·중·하) → 근황토크용 가짜 소개팅 썰(10줄 이내) + 상대 프로필 + 몽타주 수치
// 몽타주(4방향 3D)는 브라우저(blind-date.html)가 만듭니다. 서버는 정해진 어휘와 0~1 수치만 고릅니다.
//
// 토큰 아끼기: 짧은 프롬프트 · 스트리밍 없음 · 생각(thinking) 끔 · 출력 상한 · 가벼운 모델부터

const GEMINI_MODELS = ["gemini-3.1-flash-lite", "gemini-2.5-flash-lite", "gemini-3.5-flash-lite", "gemini-3.5-flash"];
const TRY_NEXT = [404, 429, 500, 503];
const MAX_OUT = 1200;

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

// 상대 직업 — 분야를 가리지 않고 넓게. 요청마다 몇 개만 후보로 보냅니다.
const JOBS = [
  // 사무·경영·금융
  "회계사", "세무사", "은행원", "증권사 애널리스트", "보험계리사", "인사담당자", "마케터", "MD", "공기업 사무직",
  "물류회사 SCM", "스타트업 PM", "컨설턴트", "감정평가사", "노무사", "관세사",
  // IT·공학·연구
  "백엔드 개발자", "게임 QA", "데이터 분석가", "반도체 공정 엔지니어", "배터리 연구원", "자동차 설계 엔지니어",
  "토목 현장기사", "조선소 용접 검사관", "항공 정비사", "변리사", "화학 연구원", "기상청 예보관", "천문대 연구원",
  "UX 디자이너", "보안 관제 요원",
  // 의료·보건
  "치과의사", "한의사", "약사", "간호사", "물리치료사", "수의사", "응급구조사", "임상병리사", "치위생사", "언어재활사",
  // 교육·인문·사회
  "중학교 국어 선생님", "초등 교사", "학원 수학 강사", "대학원생(고고학)", "도서관 사서", "학예연구사", "번역가",
  "통역사", "출판사 편집자", "기자", "PD", "사회복지사", "상담심리사", "변호사", "법원 공무원", "외교부 사무관",
  // 예술·디자인·미디어
  "웹툰 작가", "일러스트레이터", "가구 디자이너", "조향사", "사진작가", "영상 편집자", "작곡가", "뮤지컬 배우",
  "오케스트라 첼리스트", "타투이스트", "패션 MD", "도예가", "건축가", "조경 설계사", "광고 카피라이터",
  // 체육·몸 쓰는 일
  "필라테스 강사", "헬스 트레이너", "프로 볼링 선수", "골프 캐디", "수영 코치", "클라이밍짐 사장", "축구 심판",
  "스키 강사", "요가 강사",
  // 서비스·현장·자영업
  "소방관", "경찰관", "해양경찰", "직업군인", "승무원", "호텔리어", "바리스타", "제빵사", "셰프", "소믈리에",
  "플로리스트", "미용사", "자동차 정비사", "택배 대리점 사장", "부동산 중개사", "농부(스마트팜)", "어부 2세",
  "양봉업자", "편의점 점주", "웨딩플래너", "장례지도사", "동물병원 테크니션", "유튜버", "보드게임 카페 사장",
];

// 대화 주제 — 문과·이과·예체능·생활 전 분야
const TOPICS = [
  // 인문·사회
  "조선시대 왕 서열 논쟁", "좋아하는 철학자", "로마 제국 생각 자주 하는지", "MBTI는 과학인가", "가장 최근에 읽은 책",
  "언어별 욕의 어감", "투표 성향 안 묻기", "명절 잔소리 대처법", "부동산 청약 점수", "경제 뉴스 읽는 습관",
  "역사 속 가고 싶은 시대", "사투리 성대모사", "고전 소설 결말 불만",
  // 이과·기술
  "블랙홀 사진", "AI가 내 직업 대체할지", "엑셀 단축키 자랑", "커피의 화학", "공룡 깃털 여부", "우주 엘리베이터",
  "양자역학 아는 척", "스마트폰 배터리 관리", "코딩 테스트 악몽", "날씨 앱 정확도", "인체의 신비(맹장)",
  "바다 깊은 곳 생물", "전기차 vs 하이브리드",
  // 예술·문화
  "인생 영화", "좋아하는 화가", "뮤지컬 덕질", "K-팝 최애 시절", "재즈 바 경험", "넷플릭스 정주행 목록",
  "사진 찍는 법", "웹툰 결말 스포", "노래방 18번", "전시회 굿즈", "인디밴드 공연", "드라마 OST",
  // 체육·몸
  "러닝 크루", "등산 vs 바다", "야구 응원 팀", "골프 입문", "헬스 3대 중량", "클라이밍", "테니스 유행",
  "마라톤 완주", "수영 영법", "축구 국대 경기",
  // 생활·취향
  "민초 vs 반민초", "부먹 vs 찍먹", "고양이 vs 강아지", "여행 계획형 vs 즉흥형", "최악의 알바 경험",
  "자취 요리", "식물 키우기 실패담", "중고거래 진상", "MBTI 궁합", "로또 되면 할 일", "어릴 때 장래희망",
  "해외여행 사건사고", "가족 단톡방", "주식 물린 이야기", "다이어트 실패", "사주·타로", "캠핑 장비 욕심",
  "좋아하는 편의점 조합", "술버릇", "첫 월급 쓴 곳",
];

// 상대 취미 — 운동·만들기·덕질·문화·생활 전반
const HOBBIES = [
  "클라이밍", "러닝 크루", "테니스", "필라테스", "골프 연습장", "서핑", "스쿠버다이빙", "백패킹", "캠핑", "낚시",
  "등산", "자전거 라이딩", "스케이트보드", "복싱", "크로스핏", "수영", "볼링", "스윙 댄스", "탱고", "요가",
  "보드게임", "방탈출", "독서모임", "필름카메라", "베이킹", "홈카페 라떼아트", "와인 공부", "위스키 시음", "커피 로스팅",
  "식물 키우기", "뜨개질", "도자기 공방", "유화 그리기", "피아노", "통기타", "LP 수집", "재즈 공연 보기", "레고",
  "건담 프라모델", "닌텐도 게임", "롤 랭크 게임", "애니 덕질", "웹소설 쓰기", "블로그 글쓰기", "빵지순례",
  "맛집 탐방 지도 만들기", "전시회 다니기", "별 보기", "마라톤", "야구 직관", "뮤지컬 관람", "외국어 공부",
  "주식 공부", "봉사활동", "반려견 산책 모임", "향수 수집", "중고 카메라 수리", "역사 유적 답사", "드럼", "요리 클래스",
];

// MBTI 16유형 — 상대 말투·행동 힌트
const MBTI_STYLE: Record<string, string> = {
  ISTJ: "약속 시간 10분 전 도착, 말이 정확하고 계획적", ISFJ: "세심하게 챙기고 리액션이 따뜻함",
  INFJ: "조용한데 갑자기 깊은 질문", INTJ: "효율 따지고 직설적, 은근한 자기 세계",
  ISTP: "말수 적고 손재주 자랑, 쿨함", ISFP: "취향 확고, 감성 사진 찍음",
  INFP: "상상력 풍부, 혼자 감동받음", INTP: "궁금한 거 끝까지 파고듦, 엉뚱한 지식",
  ESTP: "즉흥적, 2차 가자고 함", ESFP: "분위기 메이커, 리액션 과함",
  ENFP: "말 많고 텐션 높음, 주제가 튐", ENTP: "토론 좋아하고 장난스럽게 반박",
  ESTJ: "주도적으로 메뉴·동선 정함", ESFJ: "주변 사람 이야기 많고 다정함",
  ENFJ: "칭찬 잘하고 리드함", ENTJ: "목표 지향, 5년 계획 이야기",
};

// 도파민 — 하: 소소하게, 중: 반전 하나, 상: 자극적인 사건
const DOPAMINE: Record<string, string> = {
  low: "도파민 하: 잔잔하고 현실적인 소소한 에피소드. 과장 금지, 들키지 않게 생활감 있게.",
  mid: "도파민 중: 현실적이되 웃긴 반전 하나. 친구들이 '헐' 할 정도.",
  high: "도파민 상: 자극적이고 극적인 전개. 황당한 우연·반전·긴장감을 2개 이상, 마지막 줄은 강한 한 방. 단 성적 묘사·범죄·특정인 비하 금지.",
};
const TWISTS = [
  "상대가 내 전 애인의 사촌", "상대 휴대폰에 엄마 전화 7통", "옆 테이블이 회사 팀장님", "주선자가 사실 상대를 좋아함",
  "계산하려는데 상대 카드 정지", "상대가 내 중학교 짝꿍", "식당이 상대 부모님 가게", "상대가 첫 만남에 반지 얘기",
  "같이 간 노래방에서 상대가 오디션 출신", "상대가 내 SNS를 이미 다 봄", "갑자기 쏟아진 비에 우산 하나",
  "상대가 쌍둥이였고 다른 한 명이 등장", "상대 전 애인이 같은 식당 알바생", "택시 기사님이 상대 아버지",
  "상대가 내가 쓴 리뷰를 보고 그 식당을 고름", "엘리베이터에 30분 갇힘", "상대가 유튜브 구독자 50만",
  "디저트 가게 사장님이 둘 다 아는 사람", "상대가 내 회사 면접관이었음", "강아지가 목줄 풀고 끼어듦",
];

const FACES = ["oval", "round", "square", "long", "heart"];
const HAIRS = ["buzz", "short", "two_block", "perm", "slick", "bob", "long", "wave", "ponytail", "bun"];
const HAIR_COLORS = ["black", "dark_brown", "brown", "ash", "blonde"];
const GLASSES = ["none", "round", "square"];
const BUILDS = ["slim", "average", "athletic", "chubby"];
const OUTFITS = ["dandy", "casual", "hiphop"];
const TONES = ["navy", "black", "beige", "grey", "white", "olive", "burgundy"];

const SYSTEM_PROMPT = `너는 친구들 근황토크용 '그럴듯한 가짜 소개팅 썰'을 쓴다. 작성자 1인칭 시점, 문장은 "~함", "~했음", "~임", "~였음"으로 끝나는 깔끔한 음슴체(개조식). "~했잖아", "~더라" 같은 구어체 어미 금지. 대사만 따옴표 안에서 자연스럽게.
- 주선자: 듣는 친구들이 확인 못 할 먼 사이. 이름 없이 관계로만(후보 참고).
- 장소: 후보 동네 하나, 메뉴와 1인 가격대, 가게 분위기.
- 상대(p): 가명, 나이, 키(cm), 직업(후보 중), 출신 학교, MBTI(주어진 것), 취미(후보 중). 외모·성격·매너를 구체적으로, 직업다운 디테일 하나.
- n: 상대 별칭 한 단어, '~남' 또는 '~녀'로 끝나고 8자 이내 (예: 솥밥남, 클라이밍녀). 썰의 핵심 디테일에서.
- 대화: 주제 후보에서 골라 실제 오간 대사 2개 이상을 따옴표로. 상대 MBTI가 드러나는 말투.
- 취미 이야기를 꼭 넣는다: 상대 취미로 대화가 흘러간 장면 1~2줄 (구체적 에피소드, 내 반응 포함).
- 자극 정도는 '도파민' 지시를 따른다. 반전 후보가 있으면 하나 녹인다.
- 결말은 주어진 결과를 그대로. 유명인·실존 인물 금지, 비하·성적 표현 금지.
- s: 6~10줄, 줄마다 60자 안팎, 모든 줄 음슴체로 끝냄 (예: "을지로 와인바에서 만났음.", "계산은 각자 함."). t: 썰 제목 18자 이내.
- a(몽타주)는 썰 속 외모와 맞게. 0~1 수치(eye 눈크기, eyeY 눈높이, gap 눈간격, nose 코크기, mouth 입크기, mouthY 입높이, limb 팔다리길이).
JSON만: {"t":"","n":"","p":{"name":"","age":0,"h":0,"job":"","school":"","mbti":"","hobby":""},"a":{"face":"","skin":0,"hair":"","hc":"","glasses":"","eye":0,"eyeY":0,"gap":0,"nose":0,"mouth":0,"mouthY":0,"build":"","limb":0,"outfit":"","tone":""},"s":[""]}`;

const num01 = { type: "NUMBER" };
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    t: { type: "STRING" },
    n: { type: "STRING" },
    p: {
      type: "OBJECT",
      properties: {
        name: { type: "STRING" },
        age: { type: "INTEGER" },
        h: { type: "INTEGER" },
        job: { type: "STRING" },
        school: { type: "STRING" },
        mbti: { type: "STRING" },
        hobby: { type: "STRING" },
      },
      required: ["name", "age", "h", "job", "school", "mbti", "hobby"],
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
  required: ["t", "n", "p", "a", "s"],
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

const TEMPERATURE: Record<string, number> = { low: 0.9, mid: 1.1, high: 1.25 };

function askGemini(model: string, apiKey: string, ask: string, step: number, dopamine: string) {
  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
    temperature: TEMPERATURE[dopamine] ?? 1.1,
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
    const dopamine = DOPAMINE[String(body.dopamine)] ? String(body.dopamine) : "mid";

    if (!name) return reply({ error: "이름을 적어주세요." }, 400);
    if (!(age >= 20 && age <= 60)) return reply({ error: "나이는 20~60 사이로 적어주세요." }, 400);
    if (!gender) return reply({ error: "성별을 골라주세요." }, 400);
    if (!job) return reply({ error: "직업을 적어주세요." }, 400);
    if (!/^[EI][NS][TF][JP]$/.test(mbti)) return reply({ error: "MBTI 4글자를 확인해주세요." }, 400);
    if (!outcome) return reply({ error: "결말을 골라주세요." }, 400);

    // 넓은 풀에서 요청마다 몇 개만 뽑아 보냅니다 (토큰은 그대로, 다양성은 크게)
    const theirMbti = sample(Object.keys(MBTI_STYLE), 1)[0];
    const ask = [
      `작성자: <me>${name}, ${age}세 ${gender}, ${job}, ${mbti}</me>`,
      `상대: ${target === "f" ? "여" : "남"}, 작성자와 ±4세, MBTI ${theirMbti}(${MBTI_STYLE[theirMbti]})`,
      `상대 직업 후보: ${sample(JOBS, 3).join(", ")} · 취미 후보: ${sample(HOBBIES, 2).join(", ")}`,
      `대화 주제 후보: ${sample(TOPICS, 3).join(", ")}`,
      `결말: ${OUTCOMES[outcome]}${ending ? ` / ${ending}` : ""}`,
      DOPAMINE[dopamine] + (dopamine === "low" ? "" : ` 반전 후보: ${sample(TWISTS, dopamine === "high" ? 2 : 1).join(", ")}`),
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
        res = await askGemini(model, apiKey, ask, step, dopamine);
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
