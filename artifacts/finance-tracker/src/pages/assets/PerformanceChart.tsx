import {
  AreaChart,
  Area,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import type { ChartPoint } from "@/pages/assets/types";
import { formatVND, formatVNDFull } from "@/pages/assets/utils";

type PerformanceChartProps = {
  title?: string;
  seriesLabel?: string;
  emptyMessage?: string;
  chartData: ChartPoint[];
  hideValues: boolean;
};

export default function PerformanceChart({
  title = "Biến động 7 ngày",
  seriesLabel = "Tổng",
  emptyMessage = 'Chưa có dữ liệu lịch sử. Nhấn "Làm mới" để cập nhật giá.',
  chartData,
  hideValues,
}: PerformanceChartProps) {
  if (chartData.length > 0) {
    return (
      <Card className="p-4">
        <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3">{title}</p>
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(value) => (hideValues ? "" : formatVND(value))}
              tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
              axisLine={false}
              tickLine={false}
              width={60}
            />
            <Tooltip
              formatter={(value: number) => [hideValues ? "****" : formatVNDFull(value), seriesLabel]}
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Area
              type="monotone"
              dataKey="totalValue"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              fill="url(#colorTotal)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2">{title}</p>
      <p className="text-sm text-muted-foreground text-center py-6">{emptyMessage}</p>
    </Card>
  );
}
