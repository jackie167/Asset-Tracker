import { Eye, EyeOff } from "lucide-react";
import { Card } from "@/components/ui/card";

type PortfolioSummaryCardProps = {
  title?: string;
  totalValueLabel: string;
  hideValues: boolean;
  onToggleHideValues: () => void;
};

export default function PortfolioSummaryCard({
  title = "Tổng tài sản",
  totalValueLabel,
  hideValues,
  onToggleHideValues,
}: PortfolioSummaryCardProps) {
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground uppercase tracking-widest">{title}</p>
        <button
          type="button"
          onClick={onToggleHideValues}
          className="inline-flex items-center justify-center h-7 w-7 rounded-full border border-border text-muted-foreground hover:text-foreground transition-colors"
          aria-label={hideValues ? "Hiện giá trị" : "Ẩn giá trị"}
        >
          {hideValues ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      <p className="text-3xl font-bold tracking-tight">{totalValueLabel}</p>
    </Card>
  );
}
