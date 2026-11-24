"use client";

import * as React from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDate } from "@/hooks/useDate";
import type { FinancialSummaryMonthlyPoint } from "@/lib/reports/financialSummary";
import { financialSummaryCardClass, financialSummaryCardProps } from "./financialSummaryCardStyles";

type FinancialSummaryChartProps = {
  data: FinancialSummaryMonthlyPoint[];
};

export function FinancialSummaryChart({ data }: FinancialSummaryChartProps) {
  const { formatCurrencyForPrint } = useDate();

  if (data.length === 0) return null;

  const hasValues = data.some(
    (d) => Math.abs(d.revenue) > 0.005 || Math.abs(d.expense) > 0.005 || Math.abs(d.netProfit) > 0.005
  );
  if (!hasValues) return null;

  return (
    <Card className={financialSummaryCardClass} {...financialSummaryCardProps}>
      <CardHeader>
        <CardTitle className="text-base">Revenue vs Expenses vs Net Profit</CardTitle>
      </CardHeader>
      <CardContent className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 36 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="label"
              interval={0}
              angle={-35}
              textAnchor="end"
              height={56}
              tick={{ fontSize: 11 }}
            />
            <YAxis tick={{ fontSize: 11 }} width={72} />
            <Tooltip
              formatter={(value: number, name: string) => [
                formatCurrencyForPrint(value, { noSuffix: true }),
                name,
              ]}
            />
            <Legend />
            <Bar dataKey="revenue" name="Revenue" fill="#16a34a" radius={[2, 2, 0, 0]} />
            <Bar dataKey="expense" name="Expense" fill="#dc2626" radius={[2, 2, 0, 0]} />
            <Line type="monotone" dataKey="netProfit" name="Net Profit" stroke="#2563eb" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
