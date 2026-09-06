"use client";

import { FormEvent, useEffect, useState } from "react";
import { Expense, supabase } from "../lib/supabase";

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function formatAmount(amount: number) {
  return new Intl.NumberFormat("ko-KR").format(amount);
}

const fieldClassName =
  "w-full min-h-14 rounded-xl bg-white px-4 py-4 text-lg text-foreground outline-none transition placeholder:text-muted/50 focus:bg-white focus:ring-2 focus:ring-accent/30 sm:min-h-12 sm:py-3 sm:text-[15px]";

const labelClassName = "block text-[15px] font-medium text-muted sm:text-sm";

export default function Home() {
  const [date, setDate] = useState(todayString);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadExpenses() {
    const { data, error: fetchError } = await supabase
      .from("expense")
      .select("*")
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      setExpenses([]);
    } else {
      setError(null);
      setExpenses((data as Expense[]) ?? []);
    }
    setReady(true);
  }

  useEffect(() => {
    void loadExpenses();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedAmount = Number(amount.replace(/,/g, ""));
    if (!date || !description.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return;
    }

    setSaving(true);
    setError(null);

    const { error: insertError } = await supabase.from("expense").insert({
      date,
      amount: parsedAmount,
      description: description.trim(),
    });

    setSaving(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setAmount("");
    setDescription("");
    setDate(todayString());
    await loadExpenses();
  }

  async function removeExpense(id: number) {
    setError(null);
    const { error: deleteError } = await supabase.from("expense").delete().eq("id", id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setExpenses((prev) => prev.filter((item) => item.id !== id));
  }

  const total = expenses.reduce((sum, item) => sum + item.amount, 0);

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 py-12 sm:max-w-lg sm:px-8 sm:py-20">
        <header className="mb-12 sm:mb-16">
          <h1 className="text-[28px] font-semibold tracking-tight text-foreground sm:text-[32px]">
            나의 스마트 가계부
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-muted sm:text-sm">
            지출을 간단히 기록하세요.
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="space-y-8 rounded-2xl bg-surface p-6 sm:space-y-7 sm:p-8"
        >
          <div className="space-y-2">
            <label htmlFor="date" className={labelClassName}>
              날짜
            </label>
            <input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className={fieldClassName}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="amount" className={labelClassName}>
              금액
            </label>
            <div className="relative">
              <input
                id="amount"
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                className={`${fieldClassName} pr-12 font-[family-name:var(--font-outfit)] tabular-nums`}
              />
              <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-[15px] text-muted">
                원
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="description" className={labelClassName}>
              내용
            </label>
            <input
              id="description"
              type="text"
              placeholder="예: 점심 식사, 교통비"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              maxLength={80}
              className={fieldClassName}
            />
          </div>

          {error ? (
            <p className="text-[15px] text-red-500 sm:text-sm">{error}</p>
          ) : null}

          <button
            type="submit"
            disabled={saving}
            className="min-h-14 w-full rounded-xl bg-accent px-4 py-4 text-[17px] font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-12 sm:py-3.5 sm:text-[15px]"
          >
            {saving ? "저장 중…" : "저장하기"}
          </button>
        </form>

        <section className="mt-14 pb-10 sm:mt-16 sm:pb-4">
          <div className="mb-6 flex items-baseline justify-between gap-4">
            <h2 className="text-[15px] font-medium text-muted sm:text-sm">지출 내역</h2>
            <p className="font-[family-name:var(--font-outfit)] text-[15px] tabular-nums text-foreground sm:text-sm">
              <span className="text-muted">합계 </span>
              <span className="font-semibold tracking-tight">
                {formatAmount(total)}
                <span className="ml-0.5 text-[13px] font-medium text-muted">원</span>
              </span>
            </p>
          </div>

          {!ready ? (
            <p className="py-16 text-center text-[15px] text-muted">불러오는 중…</p>
          ) : expenses.length === 0 ? (
            <p className="py-16 text-center text-[15px] text-muted">아직 저장된 지출이 없습니다.</p>
          ) : (
            <ul className="space-y-3">
              {expenses.map((item) => (
                <li key={item.id} className="rounded-2xl bg-surface px-5 py-5 sm:px-6 sm:py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-muted">{item.date}</p>
                      <p className="mt-1 truncate text-[17px] font-medium tracking-tight text-foreground sm:text-[16px]">
                        {item.description}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void removeExpense(item.id)}
                      className="min-h-10 shrink-0 rounded-lg px-2.5 py-2 text-[13px] text-muted transition-colors hover:bg-white hover:text-foreground sm:min-h-0 sm:py-1.5"
                      aria-label={`${item.description} 삭제`}
                    >
                      삭제
                    </button>
                  </div>
                  <p className="mt-4 font-[family-name:var(--font-outfit)] text-[28px] font-semibold tracking-tight text-foreground tabular-nums sm:text-[26px]">
                    {formatAmount(item.amount)}
                    <span className="ml-1 text-[15px] font-medium text-muted">원</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
