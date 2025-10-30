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
import { Download, Loader2 } from "lucide-react";
import { InventoryItem } from "@shared/schema";
import { jsPDF } from "jspdf";
import JsBarcode from "jsbarcode";
import { useToast } from "@/hooks/use-toast";

interface ExportModalProps {
  items: InventoryItem[];
  isOpen: boolean;
  onClose: () => void;
}

export function ExportModal({ items, isOpen, onClose }: ExportModalProps) {
  const [format, setFormat] = useState<"csv" | "pdf">("csv");
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

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

  const loadImage = (url: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  };

  const generateBarcodeDataURL = (barcodeData: string): string => {
    const canvas = document.createElement("canvas");
    try {
      JsBarcode(canvas, barcodeData, {
        format: "CODE128",
        width: 2,
        height: 60,
        displayValue: true,
        fontSize: 14,
        margin: 10,
      });
      return canvas.toDataURL("image/png");
    } catch (error) {
      console.error("Error generating barcode:", error);
      return "";
    }
  };

  const exportToPDF = async () => {
    setIsExporting(true);
    let failedImages = 0;
    try {
      const pdf = new jsPDF();
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 15;
      const maxWidth = pageWidth - (margin * 2);

      const addHeader = () => {
        pdf.setFontSize(18);
        pdf.text("Inventory Report", margin, margin + 5);
        pdf.setFontSize(10);
        pdf.text(`Generated: ${new Date().toLocaleDateString()}`, margin, margin + 12);
        pdf.text(`Total Items: ${items.length}`, margin, margin + 17);
      };

      const renderItemMetadata = (item: InventoryItem, currentY: number): number => {
        let y = currentY;
        pdf.setFillColor(240, 240, 240);
        pdf.rect(margin, y - 5, maxWidth, 8, "F");
        pdf.setFontSize(12);
        pdf.setFont("helvetica", "bold");
        pdf.text(item.name, margin + 2, y);
        y += 10;
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9);
        pdf.text(`Category: ${item.category}`, margin + 2, y);
        y += 5;
        if (item.tags && item.tags.length > 0) {
          pdf.text(`Tags: ${item.tags.join(", ")}`, margin + 2, y);
          y += 5;
        }
        if (item.estimatedValue) {
          pdf.text(`Estimated Value: $${item.estimatedValue}`, margin + 2, y);
          y += 5;
        }
        return y;
      };

      addHeader();
      let yPosition = margin + 30;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        if (yPosition > pageHeight - 80) {
          pdf.addPage();
          addHeader();
          yPosition = margin + 30;
        }

        yPosition = renderItemMetadata(item, yPosition);

        const descLines = pdf.splitTextToSize(item.description || "No description", maxWidth - 4);
        const descHeight = descLines.length * 4 + 3;
        
        if (yPosition + descHeight > pageHeight - 50) {
          pdf.addPage();
          addHeader();
          yPosition = renderItemMetadata(item, margin + 30);
        }
        
        pdf.text(descLines, margin + 2, yPosition);
        yPosition += descHeight;

        try {
          if (item.imageUrl) {
            const img = await loadImage(item.imageUrl);
            const imgWidth = 40;
            const imgHeight = (img.height / img.width) * imgWidth;
            
            if (yPosition + imgHeight + 10 > pageHeight - 30) {
              pdf.addPage();
              addHeader();
              yPosition = renderItemMetadata(item, margin + 30);
            }
            
            pdf.addImage(img, "JPEG", margin + 2, yPosition, imgWidth, imgHeight);
            yPosition += imgHeight + 5;
          }
        } catch (error) {
          console.error("Error loading item image:", error);
          failedImages++;
        }

        const barcodeDataURL = generateBarcodeDataURL(item.barcodeData);
        if (barcodeDataURL) {
          if (yPosition + 30 > pageHeight - 15) {
            pdf.addPage();
            addHeader();
            yPosition = renderItemMetadata(item, margin + 30);
          }
          pdf.addImage(barcodeDataURL, "PNG", margin + 2, yPosition, 60, 20);
          yPosition += 25;
        }

        yPosition += 10;
      }

      pdf.save(`inventory-${new Date().toISOString().split('T')[0]}.pdf`);
      
      if (failedImages > 0) {
        toast({
          title: "PDF Generated with Warnings",
          description: `${failedImages} image(s) could not be loaded and were skipped.`,
          variant: "default",
        });
      } else {
        toast({
          title: "PDF Generated Successfully",
          description: `Exported ${items.length} items to PDF.`,
        });
      }
      
      onClose();
    } catch (error) {
      console.error("Error generating PDF:", error);
      toast({
        title: "Export Failed",
        description: "There was an error generating the PDF. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExport = () => {
    if (format === "csv") {
      exportToCSV();
    } else {
      exportToPDF();
    }
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
            <RadioGroup value={format} onValueChange={(value) => setFormat(value as "csv" | "pdf")}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="csv" id="csv" data-testid="radio-csv" />
                <Label htmlFor="csv" className="font-normal cursor-pointer">
                  CSV (Comma-separated values)
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="pdf" id="pdf" data-testid="radio-pdf" />
                <Label htmlFor="pdf" className="font-normal cursor-pointer">
                  PDF (With images and barcodes)
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
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-export" disabled={isExporting}>
            Cancel
          </Button>
          <Button onClick={handleExport} data-testid="button-export" disabled={isExporting}>
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                Export
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
