"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Expense, supabase } from "@/lib/supabase";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

function formatAmount(amount: number) {
  return new Intl.NumberFormat("ko-KR").format(amount);
}

export default function Home() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expensesReady, setExpensesReady] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "안녕하세요! 지출을 기록하거나 통계를 물어보세요.\n예: 오늘 점심 12,000원\n예: 이번 달 총 지출이 얼마야?",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function handleSend(event?: FormEvent) {
    event?.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setSending(true);

    try {
      const history = messages
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

  async function removeExpense(id: number) {
    const { error } = await supabase.from("expense").delete().eq("id", id);
    if (!error) {
      setExpenses((prev) => prev.filter((item) => item.id !== id));
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

      <div className="mx-auto flex w-full max-w-xl shrink-0 flex-col gap-2 px-3 pt-3 sm:px-4">
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
                  {msg.content}
                </div>
              </div>
            ))}

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
        <div className="flex items-center gap-2 rounded-full bg-white px-2 py-2 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="지출 입력 또는 질문…"
            disabled={sending}
            className="min-h-11 flex-1 bg-transparent px-3 text-[16px] text-foreground outline-none placeholder:text-muted/60 disabled:opacity-60 sm:text-[15px]"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="flex h-11 min-w-11 shrink-0 items-center justify-center rounded-full bg-accent px-4 text-[14px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            전송
          </button>
        </div>
      </form>
    </div>
  );
}
