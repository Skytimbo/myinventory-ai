import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, PackagePlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  ALL_PHOTOS_KEY,
  describeContext,
  invalidateCaptureQueries,
  UNSORTED_PHOTOS_KEY,
  type CreatedItem,
  type PhotoView,
} from "@/lib/captureQueries";

const MAX_PHOTOS_PER_ITEM = 10;

/**
 * Captured photos waiting to be catalogued. Select one or more to create an
 * inventory entry; a photo can be reused for several entries via "All photos".
 */
export function PhotoTray() {
  const { toast } = useToast();
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [identify, setIdentify] = useState(false);
  const [creating, setCreating] = useState(false);
  const { data: photos = [], isLoading } = useQuery<PhotoView[]>({
    queryKey: showAll ? ALL_PHOTOS_KEY : UNSORTED_PHOTOS_KEY,
  });
  const { data: unsorted = [] } = useQuery<PhotoView[]>({ queryKey: UNSORTED_PHOTOS_KEY });

  if (!showAll && unsorted.length === 0 && !isLoading) {
    return null;
  }

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : current.length < MAX_PHOTOS_PER_ITEM ? [...current, id] : current
    );

  const create = async () => {
    setCreating(true);
    try {
      const response = await apiRequest("POST", "/api/items/from-photos", {
        photoIds: selected,
        name: name.trim() || undefined,
        identify,
      });
      const item: CreatedItem = await response.json();
      await invalidateCaptureQueries();
      toast({
        title: "Item created",
        description: item._aiWarning ?? `"${item.name}" was added from ${selected.length} photo${selected.length === 1 ? "" : "s"}.`,
        variant: item._aiWarning ? "destructive" : undefined,
      });
      setSelected([]);
      setName("");
    } catch (error) {
      toast({
        title: "Could not create item",
        description: error instanceof Error ? error.message.replace(/^\d+: /, "") : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="space-y-3 rounded-lg border p-4" data-testid="section-photo-tray">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {showAll ? "All photos" : "Unsorted photos"}{" "}
          <span className="text-muted-foreground text-base" data-testid="text-tray-count">
            ({showAll ? photos.length : unsorted.length})
          </span>
        </h2>
        <Button variant="ghost" size="sm" onClick={() => setShowAll(!showAll)} data-testid="button-tray-toggle">
          {showAll ? "Show unsorted only" : "Show all photos"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Select the photos that show one thing (up to {MAX_PHOTOS_PER_ITEM}) and create an item. Leave the rest for later.
      </p>

      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
        {photos.map((photo) => {
          const isSelected = selected.includes(photo.id);
          return (
            <button
              key={photo.id}
              type="button"
              onClick={() => toggle(photo.id)}
              className={cn(
                "relative aspect-square overflow-hidden rounded-md border text-left",
                isSelected && "ring-2 ring-primary"
              )}
              aria-pressed={isSelected}
              title={[photo.originalFilename, photo.sessionTitle, describeContext(photo.context)].filter(Boolean).join("\n")}
              data-testid={`photo-${photo.id}`}
            >
              <img src={photo.objectPath} alt={photo.originalFilename ?? "Captured photo"} loading="lazy" className="h-full w-full object-cover" />
              {isSelected && (
                <span className="absolute top-1 right-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                  <Check className="w-3 h-3" />
                </span>
              )}
              {photo.itemIds.length > 0 && (
                <Badge variant="secondary" className="absolute bottom-1 left-1 text-[10px]">
                  in {photo.itemIds.length} item{photo.itemIds.length === 1 ? "" : "s"}
                </Badge>
              )}
              {photo.context && describeContext(photo.context) && (
                <span className="absolute bottom-0 inset-x-0 truncate bg-black/50 px-1 text-[10px] text-white">
                  {describeContext(photo.context)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3" data-testid="bar-create-from-photos">
          <Input
            className="max-w-xs"
            placeholder="Name (optional)"
            value={name}
            onChange={(event) => setName(event.target.value)}
            data-testid="input-new-item-name"
          />
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={identify} onChange={(event) => setIdentify(event.target.checked)} data-testid="checkbox-identify-now" />
            Identify with AI now
          </label>
          <Button onClick={create} disabled={creating} data-testid="button-create-from-photos">
            {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PackagePlus className="w-4 h-4 mr-2" />}
            Create item from {selected.length} photo{selected.length === 1 ? "" : "s"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
            Clear
          </Button>
        </div>
      )}
    </section>
  );
}
