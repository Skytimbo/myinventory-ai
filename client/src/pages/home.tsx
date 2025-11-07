import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { InventoryItem } from "@shared/schema";
import { CameraCapture } from "@/components/CameraCapture";
import { Dashboard } from "@/components/Dashboard";
import { ItemCard } from "@/components/ItemCard";
import { SearchFilter } from "@/components/SearchFilter";
import { BarcodeModal } from "@/components/BarcodeModal";
import { ExportModal } from "@/components/ExportModal";
import { Button } from "@/components/ui/button";
import { Download, Loader2, Camera, Package } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { ObjectUploader } from "@/components/ObjectUploader";
import type { UploadResult } from "@uppy/core";

export default function Home() {
  const [showCapture, setShowCapture] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [valueRange, setValueRange] = useState<[number, number]>([0, 10000]);
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([null, null]);
  const { toast } = useToast();

  const { data: items = [], isLoading } = useQuery<InventoryItem[]>({
    queryKey: ["/api/items"],
  });

  const createItemMutation = useMutation({
    mutationFn: async (data: FormData) => {
      return await apiRequest("POST", "/api/items", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      setShowCapture(false);
      toast({
        title: "Item Added",
        description: "Your item has been successfully added to inventory.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add item. Please try again.",
        variant: "destructive",
      });
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/items/${id}`, undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({
        title: "Item Deleted",
        description: "Item has been removed from inventory.",
      });
    },
  });

  const handleImageCapture = async (imageDataUrl: string, location?: string) => {
    const formData = new FormData();
    
    const blob = await fetch(imageDataUrl).then(res => res.blob());
    formData.append("image", blob, "capture.jpg");
    
    if (location) {
      formData.append("location", location);
    }
    
    createItemMutation.mutate(formData);
  };

  const handleObjectUpload = async () => {
    const response = await fetch("/api/objects/upload", {
      method: "POST",
    });
    const data = await response.json();
    return {
      method: "PUT" as const,
      url: data.uploadURL,
    };
  };

  const handleUploadComplete = async (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => {
    const uploadedFile = result.successful[0];
    if (uploadedFile) {
      const imageUrl = uploadedFile.uploadURL;
      
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      
      const formData = new FormData();
      formData.append("image", blob, "upload.jpg");
      formData.append("imageUrl", imageUrl);
      
      createItemMutation.mutate(formData);
    }
  };

  const categories = Array.from(new Set(items.map(item => item.category)));
  const locations = Array.from(new Set(items.map(item => item.location).filter((loc): loc is string => !!loc)));
  const maxValue = Math.max(...items.map(item => parseFloat(item.estimatedValue || "0")), 1000);

  const filteredItems = items.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesCategory = selectedCategories.length === 0 || selectedCategories.includes(item.category);
    
    const matchesLocation = selectedLocations.length === 0 || 
      (item.location && selectedLocations.includes(item.location));
    
    const itemValue = parseFloat(item.estimatedValue || "0");
    const matchesValue = itemValue >= valueRange[0] && itemValue <= valueRange[1];
    
    const itemDate = new Date(item.createdAt);
    const matchesDateFrom = !dateRange[0] || itemDate >= dateRange[0];
    const matchesDateTo = !dateRange[1] || (() => {
      const endOfDay = new Date(dateRange[1]);
      endOfDay.setHours(23, 59, 59, 999);
      return itemDate <= endOfDay;
    })();
    const matchesDateRange = matchesDateFrom && matchesDateTo;
    
    return matchesSearch && matchesCategory && matchesLocation && matchesValue && matchesDateRange;
  });

  const handleCategoryToggle = (category: string) => {
    setSelectedCategories(prev =>
      prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  };

  const handleLocationToggle = (location: string) => {
    setSelectedLocations(prev =>
      prev.includes(location)
        ? prev.filter(l => l !== location)
        : [...prev, location]
    );
  };

  const handleClearFilters = () => {
    setSearchQuery("");
    setSelectedCategories([]);
    setSelectedLocations([]);
    setValueRange([0, maxValue]);
    setDateRange([null, null]);
  };

  if (showCapture) {
    return (
      <div className="min-h-screen bg-background">
        <CameraCapture onImageCapture={handleImageCapture} />
        {createItemMutation.isPending && (
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-card p-8 rounded-xl shadow-lg text-center space-y-4">
              <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto" data-testid="loader-analyzing" />
              <div>
                <h3 className="text-lg font-semibold mb-1">Analyzing Image...</h3>
                <p className="text-sm text-muted-foreground">AI is identifying your item</p>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <h1 className="text-2xl font-semibold" data-testid="text-app-title">MyInventory AI</h1>
          <div className="flex items-center gap-3">
            <ObjectUploader
              maxNumberOfFiles={1}
              maxFileSize={10485760}
              onGetUploadParameters={handleObjectUpload}
              onComplete={handleUploadComplete}
              buttonClassName="hidden sm:flex"
            >
              <Download className="w-4 h-4 mr-2" />
              Upload Image
            </ObjectUploader>
            <Button onClick={() => setShowCapture(true)} data-testid="button-add-item">
              <Camera className="w-4 h-4 mr-2" />
              Add Item
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-8">
        <Dashboard items={items} />

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl md:text-3xl font-semibold">
              Inventory
              <span className="text-muted-foreground ml-2 text-xl" data-testid="text-filtered-count">
                ({filteredItems.length})
              </span>
            </h2>
            <Button
              variant="outline"
              onClick={() => setShowExportModal(true)}
              disabled={items.length === 0}
              data-testid="button-open-export"
            >
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </div>

          <SearchFilter
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            categories={categories}
            selectedCategories={selectedCategories}
            onCategoryToggle={handleCategoryToggle}
            locations={locations}
            selectedLocations={selectedLocations}
            onLocationToggle={handleLocationToggle}
            maxValue={maxValue}
            valueRange={valueRange}
            onValueRangeChange={setValueRange}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            onClearFilters={handleClearFilters}
          />
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="animate-pulse">
                <div className="aspect-square bg-muted rounded-xl mb-4" />
                <div className="h-4 bg-muted rounded w-3/4 mb-2" />
                <div className="h-3 bg-muted rounded w-full" />
              </div>
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-16">
            <Package className="w-24 h-24 text-muted-foreground mx-auto mb-4" data-testid="icon-empty-state" />
            <h3 className="text-xl font-semibold mb-2">
              {items.length === 0 ? "No items yet" : "No items found"}
            </h3>
            <p className="text-muted-foreground mb-6">
              {items.length === 0
                ? "Start by adding your first item to the inventory"
                : "Try adjusting your search or filters"}
            </p>
            {items.length === 0 && (
              <Button onClick={() => setShowCapture(true)} data-testid="button-add-first-item">
                <Camera className="w-4 h-4 mr-2" />
                Add Your First Item
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredItems.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                onDelete={(id) => deleteItemMutation.mutate(id)}
                onViewBarcode={setSelectedItem}
              />
            ))}
          </div>
        )}
      </main>

      <BarcodeModal
        item={selectedItem}
        isOpen={!!selectedItem}
        onClose={() => setSelectedItem(null)}
      />

      <ExportModal
        items={filteredItems}
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
      />
    </div>
  );
}
