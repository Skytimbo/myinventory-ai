import { useState } from "react";
import { Search, SlidersHorizontal, Calendar as CalendarIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { format } from "date-fns";

interface SearchFilterProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  categories: string[];
  selectedCategories: string[];
  onCategoryToggle: (category: string) => void;
  locations: string[];
  selectedLocations: string[];
  onLocationToggle: (location: string) => void;
  locationCounts: Record<string, number>;
  maxValue: number;
  valueRange: [number, number];
  onValueRangeChange: (range: [number, number]) => void;
  dateRange: [Date | null, Date | null];
  onDateRangeChange: (range: [Date | null, Date | null]) => void;
  onClearFilters: () => void;
}

export function SearchFilter({
  searchQuery,
  onSearchChange,
  categories,
  selectedCategories,
  onCategoryToggle,
  locations,
  selectedLocations,
  onLocationToggle,
  locationCounts,
  maxValue,
  valueRange,
  onValueRangeChange,
  dateRange,
  onDateRangeChange,
  onClearFilters,
}: SearchFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [datePickerType, setDatePickerType] = useState<'from' | 'to' | null>(null);

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

            {locations.length > 0 && (
              <div className="space-y-3">
                <Label className="text-sm font-semibold">Location</Label>
                <div className="flex flex-wrap gap-2">
                  {locations.map((location) => {
                    const isSelected = selectedLocations.includes(location);
                    const count = locationCounts[location] || 0;
                    return (
                      <Badge
                        key={location}
                        variant={isSelected ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => onLocationToggle(location)}
                        data-testid={`badge-location-${location}`}
                      >
                        <span className="line-clamp-1">{location}</span>
                        <span className="ml-1.5 opacity-70">({count})</span>
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}

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

            <div className="space-y-3">
              <Label className="text-sm font-semibold">Date Added</Label>
              <div className="grid grid-cols-2 gap-2">
                <Popover open={datePickerType === 'from'} onOpenChange={(open) => setDatePickerType(open ? 'from' : null)}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="justify-start text-left font-normal"
                      data-testid="button-date-from"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateRange[0] ? format(dateRange[0], "MMM d, yyyy") : "From"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dateRange[0] || undefined}
                      onSelect={(date) => {
                        onDateRangeChange([date || null, dateRange[1]]);
                        setDatePickerType(null);
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>

                <Popover open={datePickerType === 'to'} onOpenChange={(open) => setDatePickerType(open ? 'to' : null)}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="justify-start text-left font-normal"
                      data-testid="button-date-to"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateRange[1] ? format(dateRange[1], "MMM d, yyyy") : "To"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dateRange[1] || undefined}
                      onSelect={(date) => {
                        onDateRangeChange([dateRange[0], date || null]);
                        setDatePickerType(null);
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

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
