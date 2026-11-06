import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { AssertableField, InventoryItem } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { invalidateCaptureQueries } from "@/lib/captureQueries";

type FormState = Record<AssertableField, string>;

const FIELDS: Array<{ key: AssertableField; label: string; multiline?: boolean; hint?: string }> = [
  { key: "name", label: "Name" },
  { key: "description", label: "Description", multiline: true },
  { key: "category", label: "Category" },
  { key: "tags", label: "Tags", hint: "Comma separated" },
  { key: "location", label: "Location" },
  { key: "notes", label: "Notes", multiline: true },
];

function toForm(item: InventoryItem): FormState {
  return {
    name: item.name,
    description: item.description,
    category: item.category,
    tags: item.tags.join(", "),
    location: item.location ?? "",
    notes: item.notes ?? "",
  };
}

const parseTags = (text: string) =>
  Array.from(new Set(text.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean)));

/** Who supplied the current value of a field */
export function fieldProvenance(item: InventoryItem, field: AssertableField): "user" | "batch_context" | "ai" | null {
  const assertion = item.userAssertions?.[field];
  if (assertion) return assertion.source;
  if (item.identification && ["name", "description", "category", "tags"].includes(field)) return "ai";
  return null;
}

const PROVENANCE_LABELS = {
  user: "Confirmed by you",
  batch_context: "From capture",
  ai: "AI suggested",
} as const;

interface ItemEditDialogProps {
  item: InventoryItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Edit an item's details. Saving records every changed field as the user's
 * assertion; AI identification will not overwrite it afterwards.
 */
export function ItemEditDialog({ item, open, onOpenChange }: ItemEditDialogProps) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(() => toForm(item));
  const [saving, setSaving] = useState(false);
  const suggestions = item.identification?.suggestions ?? {};

  useEffect(() => {
    if (open) setForm(toForm(item));
  }, [open, item]);

  const send = async (body: Record<string, unknown>, done: string) => {
    setSaving(true);
    try {
      await apiRequest("PATCH", `/api/items/${item.id}`, body);
      await invalidateCaptureQueries();
      toast({ title: done });
      return true;
    } catch (error) {
      toast({
        title: "Could not save",
        description: error instanceof Error ? error.message.replace(/^\d+: /, "") : "Please try again.",
        variant: "destructive",
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    const original = toForm(item);
    const fields: Record<string, unknown> = {};
    for (const { key } of FIELDS) {
      if (form[key].trim() === original[key].trim()) continue;
      if (key === "tags") fields.tags = parseTags(form.tags);
      else if (key === "location" || key === "notes") fields[key] = form[key].trim() || null;
      else fields[key] = form[key].trim();
    }
    if (Object.keys(fields).length === 0) {
      onOpenChange(false);
      return;
    }
    if (await send({ fields }, "Changes saved")) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-w-lg" data-testid={`dialog-edit-${item.id}`}>
        <DialogHeader>
          <DialogTitle>Edit item</DialogTitle>
          <DialogDescription>
            Your changes are recorded as your own statements. AI identification won't overwrite them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {FIELDS.map(({ key, label, multiline, hint }) => {
            const provenance = fieldProvenance(item, key);
            const suggestion = (suggestions as Record<string, unknown>)[key];
            const Control = multiline ? Textarea : Input;
            return (
              <div key={key} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Label htmlFor={`edit-${key}`}>{label}</Label>
                  {provenance && (
                    <Badge variant="outline" className="text-[10px]" data-testid={`provenance-${key}`}>
                      {PROVENANCE_LABELS[provenance]}
                    </Badge>
                  )}
                </div>
                <Control
                  id={`edit-${key}`}
                  value={form[key]}
                  placeholder={hint}
                  onChange={(event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                    setForm({ ...form, [key]: event.target.value })
                  }
                  data-testid={`input-edit-${key}`}
                />
                {suggestion !== undefined && (
                  <p className="text-xs text-muted-foreground" data-testid={`suggestion-${key}`}>
                    AI suggests: {Array.isArray(suggestion) ? suggestion.join(", ") : String(suggestion)}{" "}
                    <button
                      type="button"
                      className="text-blue-600 hover:underline"
                      disabled={saving}
                      onClick={() => send({ acceptSuggestions: [key] }, "Suggestion applied")}
                      data-testid={`button-accept-${key}`}
                    >
                      Use
                    </button>
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !form.name.trim() || !form.category.trim()} data-testid="button-save-edit">
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
