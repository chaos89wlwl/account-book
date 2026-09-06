import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { Expense, supabase } from "@/lib/supabase";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type Intent = "expense" | "query" | "chat";

type AnalysisResult = {
  date: string | null;
  amount: number | null;
  description: string | null;
  reply: string;
  complete: boolean;
};

const MODEL_CANDIDATES = [
  "gemini-3.8-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-flash-latest",
];

function koreaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function koreaYesterday() {
  const today = koreaToday();
  const date = new Date(`${today}T12:00:00+09:00`);
  date.setDate(date.getDate() - 1);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatKoreanDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return `${year}년 ${month}월 ${day}일`;
}

function formatAmount(amount: number) {
  return new Intl.NumberFormat("ko-KR").format(amount);
}

function buildConfirmReply(date: string, amount: number, description: string) {
  return `${formatKoreanDate(date)} ${description} ${formatAmount(amount)}원을 저장했어요!`;
}

function hasAmountMention(message: string) {
  return /(?:\d{1,3}(?:,\d{3})*|\d+(?:\.\d+)?)\s*만\s*원|(?:\d{1,3}(?:,\d{3})*|\d+)\s*원|[₩￦]\s*\d/.test(
    message,
  );
}

function hasQuestionCue(message: string) {
  return /(얼마|뭐|어떻게|어디|언제|왜|몇|총\s*지출|합계|가장|많이\s*쓴|적게|지난주|이번\s*달|저번|통계|분석|알려|보여|뭐야|썼어|샀더라|쓰고\s*있|\?)/.test(
    message,
  );
}

/** 금액 포함 → 지출 입력, 의문사/질문 → 통계 질문 */
function detectIntent(message: string): Intent {
  const amount = hasAmountMention(message);
  const question = hasQuestionCue(message);

  if (amount && !question) return "expense";
  if (question && !amount) return "query";

  if (amount && question) {
    // "총/얼마/가장…"처럼 통계 성격이면 질문 우선
    if (/(얼마|총|합계|가장|몇\s*번|있어\?|어때|분석)/.test(message)) {
      return "query";
    }
    return "expense";
  }

  if (question) return "query";
  if (amount) return "expense";
  return "chat";
}

function isValidExpense(data: {
  date: string | null;
  amount: number | null;
  description: string | null;
}): data is { date: string; amount: number; description: string } {
  return (
    typeof data.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(data.date) &&
    typeof data.amount === "number" &&
    Number.isFinite(data.amount) &&
    data.amount > 0 &&
    typeof data.description === "string" &&
    data.description.trim().length > 0
  );
}

async function generateWithGemini(options: {
  apiKey: string;
  systemInstruction: string;
  contents: { role: "user" | "model"; parts: { text: string }[] }[];
  schema: object;
}) {
  const genAI = new GoogleGenerativeAI(options.apiKey);
  let lastError: Error | null = null;

  for (const modelName of MODEL_CANDIDATES) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: options.schema as never,
        },
        systemInstruction: options.systemInstruction,
      });

      const result = await model.generateContent({ contents: options.contents });
      return result.response.text();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[api/chat] model=${modelName}`, lastError.message);
    }
  }

  throw lastError ?? new Error("Gemini API 호출에 실패했습니다.");
}

function toGeminiContents(history: ChatMessage[], message: string) {
  return [
    ...history.slice(-8).map((item) => ({
      role: item.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: item.content }],
    })),
    { role: "user" as const, parts: [{ text: message }] },
  ];
}

async function analyzeExpense(apiKey: string, message: string, history: ChatMessage[]) {
  const today = koreaToday();
  const yesterday = koreaYesterday();

  const raw = await generateWithGemini({
    apiKey,
    systemInstruction: `당신은 한국어 가계부 챗봇입니다.
사용자 메시지에서 지출 정보를 추출하세요.

오늘 날짜: ${today}
어제 날짜: ${yesterday}

규칙:
1. date는 YYYY-MM-DD. "오늘"→${today}, "어제"→${yesterday}. 날짜 없으면 ${today}.
2. amount는 원화 정수. "2만 원"→20000.
3. description은 짧은 지출 내용.
4. 날짜/금액을 모르면 complete=false, reply로 다시 물으세요.
5. complete=true일 때만 date, amount, description을 모두 채우세요.
6. reply는 친절한 한국어.`,
    contents: toGeminiContents(history, message),
    schema: {
      type: SchemaType.OBJECT,
      properties: {
        date: { type: SchemaType.STRING, nullable: true },
        amount: { type: SchemaType.INTEGER, nullable: true },
        description: { type: SchemaType.STRING, nullable: true },
        reply: { type: SchemaType.STRING },
        complete: { type: SchemaType.BOOLEAN },
      },
      required: ["date", "amount", "description", "reply", "complete"],
    },
  });

  return JSON.parse(raw) as AnalysisResult;
}

async function answerQuery(
  apiKey: string,
  message: string,
  history: ChatMessage[],
  expenses: Expense[],
) {
  const today = koreaToday();
  const yesterday = koreaYesterday();

  const expenseSummary = expenses.map((item) => ({
    date: item.date,
    amount: item.amount,
    description: item.description,
  }));

  const prompt = `사용자 질문: ${message}

오늘: ${today}
어제: ${yesterday}

지출 데이터(JSON, 최신순):
${JSON.stringify(expenseSummary, null, 2)}

위 데이터만 근거로 질문에 답하세요. 데이터에 없는 내용은 추측하지 마세요.`;

  const raw = await generateWithGemini({
    apiKey,
    systemInstruction: `당신은 친근한 한국어 가계부 비서입니다.
주어진 지출 데이터를 분석해 사용자의 통계/조회 질문에 답합니다.

규칙:
- 답변은 자연스럽고 친근한 구어체 한국어
- 금액은 천 단위 콤마(예: 20,000원)
- 데이터가 비어 있으면 아직 기록이 없다고 안내
- 필요하면 짧은 요약/팁을 한 줄 덧붙여도 됨
- JSON의 reply 필드에만 답변을 담으세요`,
    contents: [
      ...toGeminiContents(history, prompt).slice(0, -1),
      { role: "user" as const, parts: [{ text: prompt }] },
    ],
    schema: {
      type: SchemaType.OBJECT,
      properties: {
        reply: { type: SchemaType.STRING, description: "사용자에게 보여줄 답변" },
      },
      required: ["reply"],
    },
  });

  const parsed = JSON.parse(raw) as { reply: string };
  return parsed.reply?.trim() || "데이터를 확인했는데, 답변을 만들지 못했어요. 다시 물어봐 줄래요?";
}

async function answerChat(apiKey: string, message: string, history: ChatMessage[]) {
  const raw = await generateWithGemini({
    apiKey,
    systemInstruction: `당신은 친근한 한국어 가계부 챗봇입니다.
지출 기록(예: "오늘 점심 12000원")이나 통계 질문(예: "이번 달 총 지출이 얼마야?")을 도와주세요.
짧은 인사/안내는 자연스럽게 답하고, 가계부 사용법을 안내하세요.`,
    contents: toGeminiContents(history, message),
    schema: {
      type: SchemaType.OBJECT,
      properties: {
        reply: { type: SchemaType.STRING },
      },
      required: ["reply"],
    },
  });

  const parsed = JSON.parse(raw) as { reply: string };
  return (
    parsed.reply?.trim() ||
    '지출은 "오늘 점심 12000원"처럼, 통계는 "이번 달 총 지출이 얼마야?"처럼 물어봐 주세요.'
  );
}

async function fetchAllExpenses() {
  const { data, error } = await supabase
    .from("expense")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`지출 데이터를 불러오지 못했어요: ${error.message}`);
  }

  return (data as Expense[]) ?? [];
}

function friendlyGeminiError(detail: string) {
  if (/API[_ ]?KEY|api key|permission denied|401|403/i.test(detail)) {
    return "Gemini API 인증에 실패했어요. GEMINI_API_KEY를 확인해 주세요.";
  }
  if (/\b429\b|quota exceeded|rate limit|resource.?exhausted/i.test(detail)) {
    return "Gemini API 요청 한도를 초과했어요. 잠시 후 다시 시도해 주세요.";
  }
  if (/\b404\b|not found|is not found/i.test(detail)) {
    return "사용 가능한 Gemini 모델을 찾지 못했어요. API 키 권한 또는 모델명을 확인해 주세요.";
  }
  return "AI 응답 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.";
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "GEMINI_API_KEY가 설정되지 않았습니다. .env.local을 확인해 주세요." },
        { status: 500 },
      );
    }

    const body = (await request.json()) as {
      message?: string;
      history?: ChatMessage[];
    };

    const message = body.message?.trim();
    if (!message) {
      return Response.json({ error: "메시지를 입력해 주세요." }, { status: 400 });
    }

    const history = body.history ?? [];
    const intent = detectIntent(message);

    if (intent === "query") {
      const expenses = await fetchAllExpenses();
      const reply = await answerQuery(apiKey, message, history, expenses);
      return Response.json({ reply, expense: null, intent: "query" });
    }

    if (intent === "chat") {
      const reply = await answerChat(apiKey, message, history);
      return Response.json({ reply, expense: null, intent: "chat" });
    }

    const analysis = await analyzeExpense(apiKey, message, history);
    const extracted = {
      date: analysis.date,
      amount: typeof analysis.amount === "number" ? analysis.amount : null,
      description: analysis.description?.trim() || null,
    };

    if (!analysis.complete || !isValidExpense(extracted)) {
      const missing: string[] = [];
      if (!extracted.amount || extracted.amount <= 0) missing.push("금액");
      if (!extracted.date || !/^\d{4}-\d{2}-\d{2}$/.test(extracted.date)) missing.push("날짜");
      if (!extracted.description) missing.push("내용");

      const fallbackAsk =
        missing.length > 0
          ? `${missing.join(", ")}을(를) 알 수 없어요. 예: "어제 택시 20000원"처럼 다시 알려 주세요.`
          : "날짜와 금액을 포함해서 다시 말씀해 주세요.";

      return Response.json({
        reply: analysis.reply?.trim() || fallbackAsk,
        expense: null,
        extracted: null,
        intent: "expense",
      });
    }

    const { data, error } = await supabase
      .from("expense")
      .insert({
        date: extracted.date,
        amount: extracted.amount,
        description: extracted.description,
      })
      .select("*")
      .single();

    if (error) {
      return Response.json(
        {
          reply: `지출 정보는 파악했지만 저장에 실패했어요. 잠시 후 다시 시도해 주세요. (${error.message})`,
          expense: null,
          extracted,
          intent: "expense",
        },
        { status: 200 },
      );
    }

    return Response.json({
      reply: buildConfirmReply(extracted.date, extracted.amount, extracted.description),
      expense: data,
      extracted,
      intent: "expense",
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "알 수 없는 오류";
    console.error("[api/chat]", detail);
    return Response.json({ error: friendlyGeminiError(detail), detail }, { status: 500 });
  }
}
