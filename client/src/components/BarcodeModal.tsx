import { useEffect, useRef } from "react";
import { InventoryItem } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import JsBarcode from "jsbarcode";

interface BarcodeModalProps {
  item: InventoryItem | null;
  isOpen: boolean;
  onClose: () => void;
}

export function BarcodeModal({ item, isOpen, onClose }: BarcodeModalProps) {
  const barcodeRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (barcodeRef.current && item) {
      try {
        JsBarcode(barcodeRef.current, item.barcodeData, {
          format: "CODE128",
          width: 3,
          height: 100,
          displayValue: true,
          fontSize: 20,
          margin: 20,
        });
      } catch (error) {
        console.error("Error generating barcode:", error);
      }
    }
  }, [item]);

  const downloadBarcode = () => {
    if (barcodeRef.current && item) {
      const link = document.createElement("a");
      link.download = `${item.name}-barcode.png`;
      link.href = barcodeRef.current.toDataURL();
      link.click();
    }
  };

  if (!item) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg" data-testid="dialog-barcode">
        <DialogHeader>
          <DialogTitle data-testid="text-barcode-title">{item.name}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-6 py-6">
          <div className="bg-white p-6 rounded-lg">
            <canvas ref={barcodeRef} data-testid="canvas-barcode-large" />
          </div>
          <Button onClick={downloadBarcode} className="w-full" data-testid="button-download-barcode">
            <Download className="w-4 h-4 mr-2" />
            Download Barcode
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
