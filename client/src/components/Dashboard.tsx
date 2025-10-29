import { InventoryItem } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Package, DollarSign, Grid3x3, TrendingUp } from "lucide-react";

interface DashboardProps {
  items: InventoryItem[];
}

export function Dashboard({ items }: DashboardProps) {
  const totalItems = items.length;
  const totalValue = items.reduce((sum, item) => {
    return sum + (item.estimatedValue ? parseFloat(item.estimatedValue) : 0);
  }, 0);
  const categories = new Set(items.map(item => item.category)).size;
  const avgValue = totalItems > 0 ? totalValue / totalItems : 0;

  const stats = [
    {
      label: "Total Items",
      value: totalItems,
      icon: Package,
      testId: "stat-total-items",
    },
    {
      label: "Total Value",
      value: `$${totalValue.toFixed(2)}`,
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
      label: "Avg. Value",
      value: `$${avgValue.toFixed(2)}`,
      icon: TrendingUp,
      testId: "stat-avg-value",
    },
  ];

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
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
