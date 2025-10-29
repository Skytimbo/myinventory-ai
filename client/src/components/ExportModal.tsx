import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Download } from "lucide-react";
import { InventoryItem } from "@shared/schema";

interface ExportModalProps {
  items: InventoryItem[];
  isOpen: boolean;
  onClose: () => void;
}

export function ExportModal({ items, isOpen, onClose }: ExportModalProps) {
  const [format, setFormat] = useState<"csv">("csv");

  const exportToCSV = () => {
    const headers = ["Name", "Description", "Category", "Tags", "Estimated Value", "Barcode", "Created At"];
    const rows = items.map(item => [
      item.name,
      item.description,
      item.category,
      item.tags.join("; "),
      item.estimatedValue || "",
      item.barcodeData,
      item.createdAt,
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `inventory-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md" data-testid="dialog-export">
        <DialogHeader>
          <DialogTitle>Export Inventory</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="space-y-3">
            <Label>Export Format</Label>
            <RadioGroup value={format} onValueChange={(value) => setFormat(value as "csv")}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="csv" id="csv" data-testid="radio-csv" />
                <Label htmlFor="csv" className="font-normal cursor-pointer">
                  CSV (Comma-separated values)
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="p-4 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground">
              Exporting <span className="font-semibold text-foreground" data-testid="text-item-count">{items.length}</span> items
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-export">
            Cancel
          </Button>
          <Button onClick={exportToCSV} data-testid="button-export">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
