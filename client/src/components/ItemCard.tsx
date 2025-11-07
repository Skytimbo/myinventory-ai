import { useState, useEffect, useRef } from "react";
import { InventoryItem } from "@shared/schema";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, Maximize2, Info, TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import JsBarcode from "jsbarcode";

interface ItemCardProps {
  item: InventoryItem;
  onDelete: (id: string) => void;
  onViewBarcode: (item: InventoryItem) => void;
}

export function ItemCard({ item, onDelete, onViewBarcode }: ItemCardProps) {
  const barcodeRef = useRef<HTMLCanvasElement>(null);
  const [barcodeGenerated, setBarcodeGenerated] = useState(false);

  useEffect(() => {
    if (barcodeRef.current && !barcodeGenerated) {
      try {
        JsBarcode(barcodeRef.current, item.barcodeData, {
          format: "CODE128",
          width: 2,
          height: 40,
          displayValue: false,
        });
        setBarcodeGenerated(true);
      } catch (error) {
        console.error("Error generating barcode:", error);
      }
    }
  }, [item.barcodeData, barcodeGenerated]);

  return (
    <Card className="overflow-hidden hover-elevate" data-testid={`card-item-${item.id}`}>
      <div className="aspect-square overflow-hidden bg-muted">
        <img
          src={item.imageUrl}
          alt={item.name}
          className="w-full h-full object-cover"
          data-testid={`img-item-${item.id}`}
        />
      </div>
      <CardContent className="p-4 space-y-3">
        <div>
          <h3 className="text-lg font-medium text-foreground mb-1 line-clamp-1" data-testid={`text-name-${item.id}`}>
            {item.name}
          </h3>
          <p className="text-sm text-muted-foreground line-clamp-2" data-testid={`text-description-${item.id}`}>
            {item.description}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="text-xs" data-testid={`badge-category-${item.id}`}>
            {item.category}
          </Badge>
          {item.tags.slice(0, 2).map((tag, index) => (
            <Badge key={index} variant="outline" className="text-xs" data-testid={`badge-tag-${item.id}-${index}`}>
              {tag}
            </Badge>
          ))}
        </div>

        {item.estimatedValue && (
          <div className="flex items-center gap-2">
            <p className="text-base font-semibold text-foreground font-mono" data-testid={`text-value-${item.id}`}>
              ${parseFloat(item.estimatedValue).toFixed(2)}
            </p>
            {item.valueConfidence && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge 
                    variant={
                      item.valueConfidence === 'high' ? 'default' : 
                      item.valueConfidence === 'low' ? 'outline' : 
                      'secondary'
                    }
                    className="text-xs cursor-help"
                    data-testid={`badge-confidence-${item.id}`}
                  >
                    {item.valueConfidence === 'high' ? <TrendingUp className="w-3 h-3" /> :
                     item.valueConfidence === 'low' ? <TrendingDown className="w-3 h-3" /> :
                     <Minus className="w-3 h-3" />}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="font-semibold mb-1">Confidence: {item.valueConfidence}</p>
                  {item.valueRationale && <p className="text-xs">{item.valueRationale}</p>}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        )}

        <div className="space-y-2">
          <canvas ref={barcodeRef} className="w-full h-12 bg-white rounded" data-testid={`canvas-barcode-${item.id}`} />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onViewBarcode(item)}
            className="w-full text-xs"
            data-testid={`button-view-barcode-${item.id}`}
          >
            <Maximize2 className="w-3 h-3 mr-1" />
            View Full Size
          </Button>
        </div>
      </CardContent>
      <CardFooter className="p-4 pt-0 flex gap-2">
        <Button
          variant="destructive"
          size="sm"
          onClick={() => onDelete(item.id)}
          className="flex-1"
          data-testid={`button-delete-${item.id}`}
        >
          <Trash2 className="w-4 h-4 mr-1" />
          Delete
        </Button>
      </CardFooter>
    </Card>
  );
}
