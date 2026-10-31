import { InventoryItem } from "@shared/schema";
import { formatUsd, summarizeValuations } from "@shared/valuation";
import { Card, CardContent } from "@/components/ui/card";
import { Package, DollarSign, Grid3x3, Layers, Sigma } from "lucide-react";

interface DashboardProps {
  items: InventoryItem[];
}

export function Dashboard({ items }: DashboardProps) {
  const totalItems = items.length;
  // Indicative resale only. Item estimates and category baselines are totalled
  // separately; stale, legacy, and basis-not-recorded estimates are excluded.
  const summary = summarizeValuations(items);
  const categories = new Set(items.map(item => item.category)).size;
  const money = (total: number, count: number) => (count > 0 ? formatUsd(total.toFixed(2)) : "—");
  const plural = (count: number) => `${count} item${count === 1 ? "" : "s"}`;
  const excluded = [
    summary.unrecordedCount > 0 && `${summary.unrecordedCount} with basis not recorded`,
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
      label: "Categories",
      value: categories,
      icon: Grid3x3,
      testId: "stat-categories",
    },
    {
      label: "Item estimates",
      value: money(summary.itemTotal, summary.itemCount),
      detail: `${plural(summary.itemCount)} · indicative resale`,
      icon: DollarSign,
      testId: "stat-item-total",
    },
    {
      label: "Category baselines",
      value: money(summary.categoryTotal, summary.categoryCount),
      detail: `${plural(summary.categoryCount)} · typical unattributed`,
      icon: Layers,
      testId: "stat-category-total",
    },
    {
      label: "Combined indicative total",
      value: money(summary.combinedTotal, summary.combinedCount),
      detail:
        `${plural(summary.combinedCount)} · item + category estimates` +
        (excluded.length > 0 ? ` · ${excluded.join(", ")} not counted` : ""),
      icon: Sigma,
      testId: "stat-combined-total",
    },
  ] as Array<{ label: string; value: string | number | null; detail?: string; icon: typeof Package; testId: string }>;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
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
