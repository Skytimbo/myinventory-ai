import type { BatchContext, CaptureSession, InventoryItem, Photo } from "@shared/schema";
import { queryClient } from "@/lib/queryClient";

/** Photo evidence as returned by GET /api/photos */
export interface PhotoView extends Photo {
  itemIds: string[];
  sessionId: string | null;
  sessionTitle: string | null;
  context: BatchContext | null;
}

export interface SessionSummary extends CaptureSession {
  batchCount: number;
  photoCount: number;
  unassignedCount: number;
}

export type CreatedItem = InventoryItem & { _aiWarning?: string | null };

export const UNSORTED_PHOTOS_KEY = ["/api/photos?unassigned=true"];
export const ALL_PHOTOS_KEY = ["/api/photos"];
export const SESSIONS_KEY = ["/api/capture-sessions"];
export const ITEMS_KEY = ["/api/items"];

/** Refresh everything a capture or item change can affect */
export function invalidateCaptureQueries(): Promise<unknown> {
  return Promise.all(
    [UNSORTED_PHOTOS_KEY, ALL_PHOTOS_KEY, SESSIONS_KEY, ITEMS_KEY].map((queryKey) =>
      queryClient.invalidateQueries({ queryKey })
    )
  );
}

/** "Garage › Blue bin · declutter" style summary of batch context */
export function describeContext(context: BatchContext | null): string {
  if (!context) return "";
  const place = [context.location, context.container].filter(Boolean).join(" › ");
  return [place, context.category, context.purpose].filter(Boolean).join(" · ");
}
