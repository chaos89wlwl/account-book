"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ExpenseCharts } from "@/components/ExpenseCharts";
import { Expense, supabase } from "@/lib/supabase";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
};

type SpeechRecognitionResultLike = {
  readonly isFinal: boolean;
  readonly 0: { transcript: string };
};

type SpeechRecognitionEventLike = {
  readonly resultIndex: number;
  readonly results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: ((this: SpeechRecognitionLike, ev: Event) => void) | null;
  onresult: ((this: SpeechRecognitionLike, ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((this: SpeechRecognitionLike, ev: { error: string }) => void) | null;
  onend: ((this: SpeechRecognitionLike, ev: Event) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function formatAmount(amount: number) {
  return new Intl.NumberFormat("ko-KR").format(amount);
}

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

async function compressImage(file: File): Promise<{ base64: string; mimeType: string; previewUrl: string }> {
  const previewUrl = URL.createObjectURL(file);
  const bitmap = await createImageBitmap(file);
  const maxWidth = 1600;
  const scale = Math.min(1, maxWidth / bitmap.width);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("이미지를 처리할 수 없어요.");
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const mimeType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const dataUrl = canvas.toDataURL(mimeType, 0.85);
  const base64 = dataUrl.split(",")[1] ?? "";
  if (!base64) {
    throw new Error("이미지 변환에 실패했어요.");
  }

  return { base64, mimeType, previewUrl };
}

export default function Home() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expensesReady, setExpensesReady] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "안녕하세요! 지출을 기록하거나 통계를 물어보세요.\n예: 오늘 점심 12,000원\n예: 이번 달 총 지출이 얼마야?\n마이크나 영수증 사진으로도 입력할 수 있어요.",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [analyzingReceipt, setAnalyzingReceipt] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const sendingRef = useRef(false);
  const messagesRef = useRef(messages);
  const transcriptRef = useRef("");

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);

  async function loadExpenses() {
    const { data, error } = await supabase
      .from("expense")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error) {
      setExpenses((data as Expense[]) ?? []);
    }
    setExpensesReady(true);
  }

  useEffect(() => {
    void loadExpenses();
    setSpeechSupported(Boolean(getSpeechRecognition()));
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending, listening, analyzingReceipt]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  async function sendMessage(rawText: string) {
    const text = rawText.trim();
    if (!text || sendingRef.current) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setSending(true);

    try {
      const history = messagesRef.current
        .filter((m) => m.id !== "welcome")
        .map(({ role, content }) => ({ role, content }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });

      const data = (await res.json()) as {
        reply?: string;
        expense?: Expense | null;
        error?: string;
      };

      if (!res.ok) {
        throw new Error(data.error || "요청에 실패했습니다.");
      }

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.reply || "알겠어요. 날짜와 금액을 포함해서 다시 알려 주세요.",
        },
      ]);

      if (data.expense) {
        setExpenses((prev) => [
          data.expense as Expense,
          ...prev.filter((e) => e.id !== data.expense!.id),
        ]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "오류가 발생했습니다.";
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `죄송해요. ${message}`,
        },
      ]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function handleSend(event?: FormEvent) {
    event?.preventDefault();
    void sendMessage(input);
  }

  function pushSystemNotice(content: string) {
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content,
      },
    ]);
  }

  function stopListening() {
    recognitionRef.current?.stop();
  }

  function startListening() {
    const SpeechRecognitionCtor = getSpeechRecognition();
    if (!SpeechRecognitionCtor) {
      pushSystemNotice("이 브라우저는 음성 인식을 지원하지 않아요. Chrome을 사용해 주세요.");
      return;
    }
    if (sending || listening) return;

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "ko-KR";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognitionRef.current = recognition;
    transcriptRef.current = "";

    recognition.onstart = () => {
      setListening(true);
    };

    recognition.onresult = (event) => {
      let finalText = "";
      let interim = "";
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        const piece = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalText += piece;
        } else {
          interim += piece;
        }
      }
      const combined = (finalText + interim).trim();
      transcriptRef.current = combined;
      setInput(combined);
    };

    recognition.onerror = (event) => {
      setListening(false);
      recognitionRef.current = null;

      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        pushSystemNotice("마이크 권한이 필요해요. 브라우저 설정에서 마이크를 허용해 주세요.");
        return;
      }
      if (event.error === "no-speech") {
        pushSystemNotice("음성이 감지되지 않았어요. 다시 마이크를 눌러 말해 주세요.");
        return;
      }
      if (event.error === "aborted") return;

      pushSystemNotice("음성 인식 중 문제가 발생했어요. 다시 시도해 주세요.");
    };

    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      const text = transcriptRef.current.trim();
      transcriptRef.current = "";
      if (text) {
        void sendMessage(text);
      }
    };

    try {
      recognition.start();
    } catch {
      setListening(false);
      recognitionRef.current = null;
      pushSystemNotice("음성 인식을 시작할 수 없어요. 잠시 후 다시 시도해 주세요.");
    }
  }

  function toggleListening() {
    if (listening) {
      stopListening();
      return;
    }
    startListening();
  }

  async function removeExpense(id: number) {
    const { error } = await supabase.from("expense").delete().eq("id", id);
    if (!error) {
      setExpenses((prev) => prev.filter((item) => item.id !== id));
    }
  }

  async function handleReceiptUpload(file: File | undefined) {
    if (!file || sendingRef.current || analyzingReceipt || listening) return;

    if (!file.type.startsWith("image/")) {
      pushSystemNotice("이미지 파일만 업로드할 수 있어요.");
      return;
    }

    setAnalyzingReceipt(true);
    let previewUrl = "";

    try {
      const compressed = await compressImage(file);
      previewUrl = compressed.previewUrl;

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "user",
          content: "영수증 사진을 올렸어요",
          imageUrl: previewUrl,
        },
      ]);

      const res = await fetch("/api/receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: compressed.base64,
          mimeType: compressed.mimeType,
        }),
      });

      const data = (await res.json()) as {
        reply?: string;
        expense?: Expense | null;
        error?: string;
      };

      if (!res.ok) {
        throw new Error(data.error || "영수증 분석에 실패했습니다.");
      }

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.reply || "영수증을 확인했어요.",
        },
      ]);

      if (data.expense) {
        setExpenses((prev) => [
          data.expense as Expense,
          ...prev.filter((e) => e.id !== data.expense!.id),
        ]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "오류가 발생했습니다.";
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `죄송해요. ${message}`,
        },
      ]);
    } finally {
      setAnalyzingReceipt(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="flex h-dvh flex-col bg-[#f5f5f7]">
      <header className="shrink-0 border-b border-black/5 bg-white/90 px-4 py-3.5 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex w-full max-w-xl items-center justify-between">
          <h1 className="text-[18px] font-semibold tracking-tight text-foreground sm:text-[20px]">
            AI 가계부 챗봇
          </h1>
          <p className="font-[family-name:var(--font-outfit)] text-[13px] tabular-nums text-muted">
            {expensesReady ? `${expenses.length}건` : "…"}
          </p>
        </div>
      </header>

      <div className="mx-auto flex max-h-[42vh] w-full max-w-xl shrink-0 flex-col gap-2 overflow-y-auto px-3 pt-3 sm:max-h-[38vh] sm:px-4">
        <p className="px-1 text-[12px] font-medium text-muted">저장된 지출</p>
        <div className="scrollbar-thin flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {!expensesReady ? (
            <div className="rounded-2xl bg-white px-4 py-3 text-[13px] text-muted">불러오는 중…</div>
          ) : expenses.length === 0 ? (
            <div className="rounded-2xl bg-white px-4 py-3 text-[13px] text-muted">
              아직 저장된 지출이 없습니다
            </div>
          ) : (
            expenses.map((item) => (
              <article
                key={item.id}
                className="relative w-[148px] shrink-0 rounded-2xl bg-white px-3.5 py-3"
              >
                <button
                  type="button"
                  onClick={() => void removeExpense(item.id)}
                  className="absolute top-2 right-2 rounded-md px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface hover:text-foreground"
                  aria-label={`${item.description} 삭제`}
                >
                  ×
                </button>
                <p className="pr-4 text-[11px] text-muted">{item.date}</p>
                <p className="mt-1 truncate text-[13px] font-medium text-foreground">
                  {item.description}
                </p>
                <p className="mt-2 font-[family-name:var(--font-outfit)] text-[18px] font-semibold tabular-nums tracking-tight text-foreground">
                  {formatAmount(item.amount)}
                  <span className="ml-0.5 text-[11px] font-medium text-muted">원</span>
                </p>
              </article>
            ))
          )}
        </div>
        {expensesReady && expenses.length > 0 ? <ExpenseCharts expenses={expenses} /> : null}
      </div>

      <div className="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col px-3 sm:px-4">
        <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-y-auto rounded-2xl bg-[#ebebf0] px-3 py-4 sm:px-4">
          <div className="flex flex-col gap-3">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {msg.role === "assistant" ? (
                  <div className="mr-2 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-white">
                    AI
                  </div>
                ) : null}
                <div
                  className={`max-w-[78%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed sm:text-[14px] ${
                    msg.role === "user"
                      ? "rounded-br-md bg-[#fee500] text-foreground"
                      : "rounded-bl-md bg-white text-foreground"
                  }`}
                >
                  {msg.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={msg.imageUrl}
                      alt="업로드한 영수증"
                      className="mb-2 max-h-48 w-full rounded-xl object-cover"
                    />
                  ) : null}
                  {msg.content}
                </div>
              </div>
            ))}

            {listening ? (
              <div className="flex justify-start">
                <div className="mr-2 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-400 text-[11px] font-semibold text-white">
                  MIC
                </div>
                <div className="rounded-2xl rounded-bl-md bg-white px-4 py-3 text-[14px] text-muted">
                  듣고 있어요… 말씀해 주세요
                </div>
              </div>
            ) : null}

            {analyzingReceipt ? (
              <div className="flex justify-start">
                <div className="mr-2 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-white">
                  AI
                </div>
                <div className="rounded-2xl rounded-bl-md bg-white px-4 py-3 text-[14px] text-muted">
                  영수증 분석 중…
                </div>
              </div>
            ) : null}

            {sending ? (
              <div className="flex justify-start">
                <div className="mr-2 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-white">
                  AI
                </div>
                <div className="rounded-2xl rounded-bl-md bg-white px-4 py-3 text-[14px] text-muted">
                  입력 중…
                </div>
              </div>
            ) : null}
            <div ref={chatEndRef} />
          </div>
        </div>
      </div>

      <form
        onSubmit={handleSend}
        className="mx-auto w-full max-w-xl shrink-0 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4"
      >
        <div className="flex items-center gap-1.5 rounded-full bg-white px-2 py-2 shadow-[0_1px_0_rgba(0,0,0,0.04)] sm:gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => void handleReceiptUpload(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || listening || analyzingReceipt}
            aria-label="영수증 사진 업로드"
            title="영수증 사진 업로드"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface text-foreground transition-colors hover:bg-[#e8e8ea] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
              <path d="M4 5a2 2 0 0 1 2-2h3.2l1.2 1.6H18a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Zm8 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={toggleListening}
            disabled={sending || analyzingReceipt || !speechSupported}
            aria-pressed={listening}
            aria-label={listening ? "음성 인식 중지" : "음성 인식 시작"}
            title={
              speechSupported
                ? listening
                  ? "녹음 중지"
                  : "음성으로 입력"
                : "이 브라우저는 음성 인식을 지원하지 않습니다"
            }
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              listening
                ? "bg-red-500 text-white hover:bg-red-600"
                : "bg-surface text-foreground hover:bg-[#e8e8ea]"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="currentColor"
              aria-hidden
            >
              {listening ? (
                <rect x="7" y="7" width="10" height="10" rx="2" />
              ) : (
                <>
                  <path d="M12 14a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v4a3 3 0 0 0 3 3Z" />
                  <path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.93V21a1 1 0 1 0 2 0v-3.07A7 7 0 0 0 19 11Z" />
                </>
              )}
            </svg>
          </button>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              analyzingReceipt
                ? "영수증 분석 중…"
                : listening
                  ? "듣고 있어요…"
                  : "지출 입력 또는 질문…"
            }
            disabled={sending || listening || analyzingReceipt}
            className="min-h-11 flex-1 bg-transparent px-2 text-[16px] text-foreground outline-none placeholder:text-muted/60 disabled:opacity-60 sm:text-[15px]"
          />
          <button
            type="submit"
            disabled={sending || listening || analyzingReceipt || !input.trim()}
            className="flex h-11 min-w-11 shrink-0 items-center justify-center rounded-full bg-accent px-4 text-[14px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            전송
          </button>
        </div>
      </form>
    </div>
  );
}
