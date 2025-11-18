import { useState } from "react";
import type { InventoryItem } from "@shared/schema";
import { cn } from "@/lib/utils";

interface ItemDetailGalleryProps {
  item: InventoryItem;
}

/**
 * ItemDetailGallery - Multi-image gallery for item detail view (PRD 0004)
 *
 * Features:
 * - Displays primary image (large)
 * - Thumbnail navigation below
 * - Click thumbnail to switch primary image
 * - Graceful fallback for single-image items
 * - Minimal design (no animations, swipe gestures, or keyboard nav per trimmed scope)
 */
export function ItemDetailGallery({ item }: ItemDetailGalleryProps) {
  const images = item.imageUrls || [item.imageUrl];
  const [primaryIndex, setPrimaryIndex] = useState(0);

  // Fallback for single-image items - simple display
  if (images.length <= 1) {
    return (
      <div className="flex justify-center bg-muted rounded-lg p-4">
        <img
          src={item.imageUrl}
          alt={item.name}
          className="max-h-[500px] w-auto object-contain rounded"
          data-testid="single-image-display"
        />
      </div>
    );
  }

  return (
    <div className="gallery space-y-4" data-testid="multi-image-gallery">
      {/* Primary image display */}
      <div className="flex justify-center bg-muted rounded-lg p-4">
        <img
          src={images[primaryIndex]}
          alt={`${item.name} - Image ${primaryIndex + 1}`}
          className="gallery-primary max-h-[500px] w-auto object-contain rounded"
          data-testid={`gallery-primary-${primaryIndex}`}
        />
      </div>

      {/* Thumbnail navigation row */}
      <div className="gallery-thumbnails flex gap-2 overflow-x-auto pb-2" data-testid="gallery-thumbnails">
        {images.map((url, index) => (
          <button
            key={index}
            onClick={() => setPrimaryIndex(index)}
            className={cn(
              "flex-shrink-0 rounded border-2 p-0 cursor-pointer transition-colors hover:border-primary/50",
              index === primaryIndex ? "border-primary" : "border-transparent"
            )}
            data-testid={`gallery-thumbnail-${index}`}
            aria-label={`View image ${index + 1}`}
            aria-current={index === primaryIndex ? "true" : "false"}
          >
            <img
              src={url}
              alt={`${item.name} - Thumbnail ${index + 1}`}
              className="w-20 h-20 object-cover rounded"
            />
          </button>
        ))}
      </div>

      {/* Image counter */}
      <div className="text-center text-sm text-muted-foreground" data-testid="gallery-counter">
        {primaryIndex + 1} / {images.length}
      </div>
    </div>
  );
}
