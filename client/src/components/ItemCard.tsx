import { useState, useEffect, useRef } from "react";
import { InventoryItem } from "@shared/schema";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2, Maximize2, ImageIcon, MapPin, Images, Sparkles, Loader2, CircleDollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getIdentificationStatus } from "@shared/valuation";
import { ValueSummary } from "@/components/ValueSummary";
import JsBarcode from "jsbarcode";

interface ItemCardProps {
  item: InventoryItem;
  onDelete: (id: string) => void;
  onViewBarcode: (item: InventoryItem) => void;
  onIdentify?: (id: string) => void;
  onEstimateValue?: (id: string) => void;
  isIdentifying?: boolean;
  isEstimating?: boolean;
}

export function ItemCard({
  item,
  onDelete,
  onViewBarcode,
  onIdentify,
  onEstimateValue,
  isIdentifying,
  isEstimating,
}: ItemCardProps) {
  const barcodeRef = useRef<HTMLCanvasElement>(null);
  const descriptionRef = useRef<HTMLParagraphElement>(null);
  const [barcodeGenerated, setBarcodeGenerated] = useState(false);

  // Image loading state
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const [imageRevision, setImageRevision] = useState(0);

  // Description expansion state
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [confirmReidentify, setConfirmReidentify] = useState(false);

  const identificationStatus = getIdentificationStatus(item);
  const isUnidentified = identificationStatus === "unidentified";
  const uncertainty = item.identification?.uncertainty;
  const aiBusy = Boolean(isIdentifying || isEstimating);

  const handleIdentifyClick = () => {
    // Re-identifying replaces name, description, category, and tags
    if (isUnidentified) {
      onIdentify?.(item.id);
    } else {
      setConfirmReidentify(true);
    }
  };
  const [isDescriptionTruncated, setIsDescriptionTruncated] = useState(false);

  // Dev-only telemetry
  const imageRetryCountRef = useRef(0);

  // Multi-image support (PRD 0004) - use imageUrls[0] if available, fallback to imageUrl
  const primaryImageUrl = item.imageUrls?.[0] || item.imageUrl;
  const imageCount = item.imageUrls?.length || 1;
  const hasMultipleImages = imageCount > 1;

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

  // Detect if description is truncated (needs "Show more" toggle)
  useEffect(() => {
    const el = descriptionRef.current;
    if (el && !descriptionExpanded) {
      // Check if text overflows the 2-line clamp
      setIsDescriptionTruncated(el.scrollHeight > el.clientHeight);
    }
  }, [item.description, descriptionExpanded]);

  return (
    <Card className="overflow-hidden hover-elevate" data-testid={`card-item-${item.id}`}>
      <div className="aspect-square overflow-hidden bg-muted relative">
        {/* Loading skeleton */}
        {imageLoading && !imageError && (
          <div className="absolute inset-0 animate-pulse bg-gray-200" data-testid={`skeleton-${item.id}`} />
        )}

        {/* Only render img when not in error state */}
        {!imageError && (
          <img
            src={`${primaryImageUrl}?rev=${imageRevision}`}
            alt={item.name || 'Item image'}
            loading="lazy"
            onLoad={() => {
              setImageLoading(false);
              setImageError(false); // Clear error state on successful load
              // Telemetry: Log successful retry
              if (process.env.NODE_ENV !== 'production' && imageRetryCountRef.current > 0) {
                console.debug('[Telemetry] Image retry success:', {
                  itemId: item.id,
                  retryCount: imageRetryCountRef.current,
                  revision: imageRevision,
                });
              }
            }}
            onError={() => {
              setImageError(true);
              setImageLoading(false);
            }}
            className={cn(
              'w-full h-full object-cover',
              imageLoading && 'opacity-50'
            )}
            data-testid={`img-item-${item.id}`}
          />
        )}

        {/* Multi-image count badge (PRD 0004) */}
        {hasMultipleImages && !imageError && (
          <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm text-white px-2 py-1 rounded-md flex items-center gap-1 text-xs font-medium" data-testid={`badge-image-count-${item.id}`}>
            <Images className="w-3 h-3" />
            <span>{imageCount}</span>
          </div>
        )}

        {/* Accessible placeholder UI for error state */}
        {imageError && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100"
            data-testid={`placeholder-${item.id}`}
            aria-label={`Image failed to load for ${item.name}`}
          >
            <ImageIcon aria-hidden className="h-12 w-12 text-gray-400" />
            <p className="sr-only">Image failed to load</p>
            <p className="mt-2 text-sm text-gray-600 text-center px-4">{item.name}</p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 text-xs underline hover:text-gray-900"
              onClick={() => {
                setImageError(false);
                setImageLoading(true);
                setImageRevision(r => r + 1); // Cache-busting

                // Telemetry: Track retry attempt
                if (process.env.NODE_ENV !== 'production') {
                  imageRetryCountRef.current++;
                  console.debug('[Telemetry] Image retry attempt:', {
                    itemId: item.id,
                    retryCount: imageRetryCountRef.current,
                  });
                }
              }}
              data-testid={`button-retry-${item.id}`}
              aria-label="Retry loading image"
            >
              Retry loading image
            </Button>
          </div>
        )}
      </div>
      <CardContent className="p-4 space-y-3">
        <div>
          <h3 className="text-lg font-medium text-foreground mb-1 line-clamp-1" data-testid={`text-name-${item.id}`}>
            {item.name}
          </h3>
          <p
            ref={descriptionRef}
            className={cn(
              "text-sm text-muted-foreground",
              !descriptionExpanded && "line-clamp-2"
            )}
            data-testid={`text-description-${item.id}`}
          >
            {item.description}
          </p>
          {item.description && (isDescriptionTruncated || descriptionExpanded) && (
            <button
              type="button"
              onClick={() => setDescriptionExpanded(!descriptionExpanded)}
              className="text-sm text-blue-600 hover:underline cursor-pointer mt-1"
              data-testid={`button-toggle-description-${item.id}`}
            >
              {descriptionExpanded ? "Show less" : "Show more"}
            </button>
          )}
        </div>

        {item.location && (
          <div className="flex items-center gap-1 text-sm text-muted-foreground" data-testid={`text-location-${item.id}`}>
            <MapPin className="w-3.5 h-3.5" />
            <span className="line-clamp-1">{item.location}</span>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="text-xs" data-testid={`badge-category-${item.id}`}>
            {item.category}
          </Badge>
          {/* Quick Capture or failed AI: not identified yet */}
          {isUnidentified && (
            <Badge variant="outline" className="text-xs bg-yellow-50 text-yellow-700 border-yellow-300" data-testid={`badge-unidentified-${item.id}`}>
              <Sparkles className="w-3 h-3 mr-1" />
              Not identified
            </Badge>
          )}
          {uncertainty && uncertainty !== "low" && (
            <Badge variant="outline" className="text-xs bg-amber-50 text-amber-800 border-amber-300" data-testid={`badge-id-uncertainty-${item.id}`}>
              {uncertainty === "high" ? "Uncertain ID" : "Likely ID"}
            </Badge>
          )}
          {item.tags.slice(0, 2).map((tag, index) => (
            <Badge key={index} variant="outline" className="text-xs" data-testid={`badge-tag-${item.id}-${index}`}>
              {tag}
            </Badge>
          ))}
        </div>

        <ValueSummary item={item} />

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
      <CardFooter className="p-4 pt-0 flex flex-wrap gap-2">
        {onIdentify && (
          <Button
            variant={isUnidentified ? "default" : "outline"}
            size="sm"
            onClick={handleIdentifyClick}
            disabled={aiBusy}
            className="flex-1 min-w-[7rem]"
            data-testid={`button-identify-${item.id}`}
          >
            {isIdentifying ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4 mr-1" />
            )}
            {isUnidentified ? "Identify" : "Re-identify"}
          </Button>
        )}
        {onEstimateValue && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEstimateValue(item.id)}
            disabled={aiBusy || isUnidentified}
            title={isUnidentified ? "Identify the item first" : undefined}
            className="flex-1 min-w-[7rem]"
            data-testid={`button-estimate-${item.id}`}
          >
            {isEstimating ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <CircleDollarSign className="w-4 h-4 mr-1" />
            )}
            {item.valuation ? "Re-estimate" : "Estimate Value"}
          </Button>
        )}
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

      <AlertDialog open={confirmReidentify} onOpenChange={setConfirmReidentify}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-identify this item?</AlertDialogTitle>
            <AlertDialogDescription>
              The AI will replace the current name, description, category, and tags.
              {item.valuation && !item.valuation.staleAt &&
                " The current value estimate will be kept but marked stale until you re-estimate."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`button-cancel-reidentify-${item.id}`}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => onIdentify?.(item.id)}
              data-testid={`button-confirm-reidentify-${item.id}`}
            >
              Re-identify
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
