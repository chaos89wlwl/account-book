"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Expense } from "@/lib/supabase";

const CHART_COLORS = [
  "#99b4d1",
  "#7a9bbf",
  "#5c7fa8",
  "#b8c9dc",
  "#6b8fb0",
  "#4a6d8c",
  "#c5d4e4",
  "#8aa4c0",
];

function formatAmount(amount: number) {
  return new Intl.NumberFormat("ko-KR").format(amount);
}

function categorize(description: string) {
  const text = description.trim().toLowerCase();

  if (/(점심|저녁|아침|식|카페|커피|배달|치킨|피자|편의점|마트|음식|식당|베이커리|빵)/.test(text)) {
    return "식비";
  }
  if (/(택시|버스|지하철|교통|주유|주차|기차|비행|우버|카카오T)/.test(text)) {
    return "교통";
  }
  if (/(쇼핑|옷|패션|쿠팡|무신사|백화점|아울렛)/.test(text)) {
    return "쇼핑";
  }
  if (/(병원|약국|건강|진료)/.test(text)) {
    return "의료";
  }
  if (/(영화|게임|넷플릭스|문화|취미|공연)/.test(text)) {
    return "문화";
  }
  if (/(통신|인터넷|휴대폰|요금|공과금|전기|가스|수도)/.test(text)) {
    return "생활비";
  }

  return description.trim() || "기타";
}

type ExpenseChartsProps = {
  expenses: Expense[];
};

export function ExpenseCharts({ expenses }: ExpenseChartsProps) {
  const monthlyData = useMemo(() => {
    const map = new Map<string, number>();

    for (const item of expenses) {
      const key = item.date.slice(0, 7); // YYYY-MM
      if (!/^\d{4}-\d{2}$/.test(key)) continue;
      map.set(key, (map.get(key) ?? 0) + item.amount);
    }

    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([month, total]) => {
        const [, m] = month.split("-");
        return {
          month,
          label: `${Number(m)}월`,
          total,
        };
      });
  }, [expenses]);

  const categoryData = useMemo(() => {
    const map = new Map<string, number>();

    for (const item of expenses) {
      const category = categorize(item.description);
      map.set(category, (map.get(category) ?? 0) + item.amount);
    }

    const sorted = [...map.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    if (sorted.length <= 6) return sorted;

    const top = sorted.slice(0, 5);
    const otherTotal = sorted.slice(5).reduce((sum, item) => sum + item.value, 0);
    return [...top, { name: "기타", value: otherTotal }];
  }, [expenses]);

  if (expenses.length === 0) return null;

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <section className="rounded-2xl bg-white px-3 py-3">
        <h3 className="mb-2 px-1 text-[12px] font-medium text-muted">월별 총 지출</h3>
        <div className="h-[160px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "#86868b" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#86868b" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) =>
                  v >= 10000 ? `${Math.round(v / 10000)}만` : `${v}`
                }
              />
              <Tooltip
                cursor={{ fill: "rgba(153,180,209,0.12)" }}
                formatter={(value) => [`${formatAmount(Number(value))}원`, "총액"]}
                labelFormatter={(_, payload) => {
                  const month = payload?.[0]?.payload?.month as string | undefined;
                  return month ?? "";
                }}
                contentStyle={{
                  border: "none",
                  borderRadius: 12,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
                  fontSize: 12,
                }}
              />
              <Bar dataKey="total" fill="#99b4d1" radius={[6, 6, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="rounded-2xl bg-white px-3 py-3">
        <h3 className="mb-2 px-1 text-[12px] font-medium text-muted">카테고리별 지출</h3>
        <div className="h-[160px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={categoryData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={36}
                outerRadius={62}
                paddingAngle={2}
              >
                {categoryData.map((entry, index) => (
                  <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value, name) => [`${formatAmount(Number(value))}원`, String(name)]}
                contentStyle={{
                  border: "none",
                  borderRadius: 12,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
                  fontSize: 12,
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 px-1">
          {categoryData.map((item, index) => (
            <li key={item.name} className="flex items-center gap-1.5 text-[11px] text-muted">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
              />
              {item.name}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
