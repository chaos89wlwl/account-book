import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { supabase } from "@/lib/supabase";

const MODEL_CANDIDATES = [
  "gemini-3.8-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-flash-latest",
];

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function koreaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatKoreanDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return `${year}년 ${month}월 ${day}일`;
}

function formatAmount(amount: number) {
  return new Intl.NumberFormat("ko-KR").format(amount);
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
  return "영수증 분석 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.";
}

type ReceiptResult = {
  date: string | null;
  amount: number | null;
  storeName: string | null;
  complete: boolean;
  reply: string;
};

async function analyzeReceiptImage(apiKey: string, imageBase64: string, mimeType: string) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const today = koreaToday();
  let lastError: Error | null = null;

  const prompt = `이 이미지는 영수증입니다. 결제 정보를 추출하세요.

오늘 날짜(참고): ${today}

추출 규칙:
1. date: 영수증의 거래 날짜를 YYYY-MM-DD로. 없으면 ${today}.
2. amount: 최종 결제 금액(합계/총액/받을금액). 원화 정수. 부가세만 쓰지 말고 총액을 쓰세요.
3. storeName: 가게/상호명. 짧고 명확하게.
4. 금액 또는 가게 이름을 확신할 수 없으면 complete=false, 해당 값은 null, reply로 다시 찍어달라고 안내.
5. complete=true일 때만 date, amount, storeName을 모두 채우세요.
6. reply는 친절한 한국어.`;

  for (const modelName of MODEL_CANDIDATES) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: SchemaType.OBJECT,
            properties: {
              date: { type: SchemaType.STRING, nullable: true, description: "YYYY-MM-DD" },
              amount: { type: SchemaType.INTEGER, nullable: true, description: "총 결제 금액(원)" },
              storeName: { type: SchemaType.STRING, nullable: true, description: "가게 이름" },
              complete: { type: SchemaType.BOOLEAN },
              reply: { type: SchemaType.STRING },
            },
            required: ["date", "amount", "storeName", "complete", "reply"],
          },
        },
      });

      const result = await model.generateContent({
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { data: imageBase64, mimeType } },
              { text: prompt },
            ],
          },
        ],
      });

      return JSON.parse(result.response.text()) as ReceiptResult;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[api/receipt] model=${modelName}`, lastError.message);
    }
  }

  throw lastError ?? new Error("Gemini Vision API 호출에 실패했습니다.");
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
      imageBase64?: string;
      mimeType?: string;
    };

    const mimeType = body.mimeType?.toLowerCase();
    const imageBase64 = body.imageBase64?.replace(/^data:[^;]+;base64,/, "").trim();

    if (!imageBase64 || !mimeType) {
      return Response.json({ error: "영수증 이미지가 없어요." }, { status: 400 });
    }

    if (!ALLOWED_MIME.has(mimeType)) {
      return Response.json(
        { error: "JPG, PNG, WEBP 형식의 이미지만 업로드할 수 있어요." },
        { status: 400 },
      );
    }

    // roughly reject > 8MB binary
    const approxBytes = (imageBase64.length * 3) / 4;
    if (approxBytes > 8 * 1024 * 1024) {
      return Response.json(
        { error: "이미지가 너무 커요. 8MB 이하로 다시 올려 주세요." },
        { status: 400 },
      );
    }

    const analysis = await analyzeReceiptImage(apiKey, imageBase64, mimeType);

    const date = analysis.date?.trim() || koreaToday();
    const amount = typeof analysis.amount === "number" ? analysis.amount : null;
    const storeName = analysis.storeName?.trim() || null;

    if (
      !analysis.complete ||
      !amount ||
      amount <= 0 ||
      !storeName ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date)
    ) {
      return Response.json({
        reply:
          analysis.reply?.trim() ||
          "영수증에서 금액이나 가게 이름을 읽지 못했어요. 더 선명한 사진으로 다시 올려 주세요.",
        expense: null,
        extracted: null,
      });
    }

    const { data, error } = await supabase
      .from("expense")
      .insert({
        date,
        amount,
        description: storeName,
      })
      .select("*")
      .single();

    if (error) {
      return Response.json({
        reply: `영수증은 인식했지만 저장에 실패했어요. (${error.message})`,
        expense: null,
        extracted: { date, amount, description: storeName },
      });
    }

    return Response.json({
      reply: `${formatKoreanDate(date)} ${storeName} ${formatAmount(amount)}원을 영수증에서 읽어 저장했어요!`,
      expense: data,
      extracted: { date, amount, description: storeName },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "알 수 없는 오류";
    console.error("[api/receipt]", detail);
    return Response.json({ error: friendlyGeminiError(detail), detail }, { status: 500 });
  }
}
