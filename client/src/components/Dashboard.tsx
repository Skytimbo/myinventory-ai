import { InventoryItem } from "@shared/schema";
import { formatUsd, summarizeValuations } from "@shared/valuation";
import { Card, CardContent } from "@/components/ui/card";
import { Package, DollarSign, Grid3x3, TrendingUp } from "lucide-react";

interface DashboardProps {
  items: InventoryItem[];
}

export function Dashboard({ items }: DashboardProps) {
  const totalItems = items.length;
  // Only current estimates count; unknown, stale, and legacy values are excluded, not $0
  const summary = summarizeValuations(items);
  const hasEstimates = summary.currentCount > 0;
  const categories = new Set(items.map(item => item.category)).size;
  const excluded = [
    summary.staleCount > 0 && `${summary.staleCount} stale`,
    summary.legacyOnlyCount > 0 && `${summary.legacyOnlyCount} legacy`,
  ].filter(Boolean);

  const stats = [
    {
      label: "Total Items",
      value: totalItems,
      icon: Package,
      testId: "stat-total-items",
    },
    {
      label: "Estimated Value",
      value: hasEstimates ? formatUsd(summary.currentTotal.toFixed(2)) : "—",
      detail: `${summary.currentCount} of ${totalItems} items estimated` +
        (excluded.length > 0 ? ` · ${excluded.join(", ")} not counted` : ""),
      icon: DollarSign,
      testId: "stat-total-value",
    },
    {
      label: "Categories",
      value: categories,
      icon: Grid3x3,
      testId: "stat-categories",
    },
    {
      label: "Avg. Estimate",
      value: hasEstimates
        ? formatUsd((summary.currentTotal / summary.currentCount).toFixed(2))
        : "—",
      detail: "Across estimated items only",
      icon: TrendingUp,
      testId: "stat-avg-value",
    },
  ] as Array<{ label: string; value: string | number | null; detail?: string; icon: typeof Package; testId: string }>;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat) => (
        <Card key={stat.label}>
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-3">
              <stat.icon className="w-8 h-8 text-primary" />
            </div>
            <div className="space-y-1">
              <p className="text-3xl font-bold text-foreground" data-testid={stat.testId}>
                {stat.value}
              </p>
              <p className="text-sm text-muted-foreground">{stat.label}</p>
              {stat.detail && (
                <p className="text-xs text-muted-foreground" data-testid={`${stat.testId}-detail`}>
                  {stat.detail}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
