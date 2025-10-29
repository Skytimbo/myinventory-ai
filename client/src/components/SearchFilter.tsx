import { useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

interface SearchFilterProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  categories: string[];
  selectedCategories: string[];
  onCategoryToggle: (category: string) => void;
  maxValue: number;
  valueRange: [number, number];
  onValueRangeChange: (range: [number, number]) => void;
  onClearFilters: () => void;
}

export function SearchFilter({
  searchQuery,
  onSearchChange,
  categories,
  selectedCategories,
  onCategoryToggle,
  maxValue,
  valueRange,
  onValueRangeChange,
  onClearFilters,
}: SearchFilterProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="flex gap-3">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search items..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-10"
          data-testid="input-search"
        />
      </div>
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="icon" data-testid="button-open-filters">
            <SlidersHorizontal className="w-5 h-5" />
          </Button>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
          </SheetHeader>
          <div className="space-y-6 mt-6">
            <div className="space-y-3">
              <Label className="text-sm font-semibold">Category</Label>
              <div className="space-y-2">
                {categories.map((category) => (
                  <label
                    key={category}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedCategories.includes(category)}
                      onChange={() => onCategoryToggle(category)}
                      className="w-4 h-4 rounded border-input"
                      data-testid={`checkbox-category-${category}`}
                    />
                    <span className="text-sm">{category}</span>
                  </label>
                ))}
              </div>
            </div>

            {maxValue > 0 && (
              <div className="space-y-3">
                <Label className="text-sm font-semibold">
                  Value Range: ${valueRange[0]} - ${valueRange[1]}
                </Label>
                <Slider
                  min={0}
                  max={maxValue}
                  step={1}
                  value={valueRange}
                  onValueChange={(value) => onValueRangeChange(value as [number, number])}
                  className="w-full"
                  data-testid="slider-value-range"
                />
              </div>
            )}

            <div className="pt-4 space-y-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={onClearFilters}
                data-testid="button-clear-filters"
              >
                Clear All Filters
              </Button>
              <Button
                className="w-full"
                onClick={() => setIsOpen(false)}
                data-testid="button-apply-filters"
              >
                Apply Filters
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
