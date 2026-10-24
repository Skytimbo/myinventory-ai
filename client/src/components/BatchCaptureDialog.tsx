import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Images } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { invalidateCaptureQueries, SESSIONS_KEY, type SessionSummary } from "@/lib/captureQueries";

/** Matches the server's per-request limit; larger selections are sent in chunks */
const CHUNK_SIZE = 25;
const CONTEXT_FIELDS = [
  { key: "location", label: "Location", placeholder: "e.g. Garage" },
  { key: "container", label: "Container", placeholder: "e.g. Blue bin" },
  { key: "category", label: "Category", placeholder: "e.g. Tools" },
  { key: "purpose", label: "Purpose", placeholder: "e.g. Declutter" },
] as const;

type ContextKey = (typeof CONTEXT_FIELDS)[number]["key"];

interface BatchCaptureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Upload many photos at once into a capture session. Context is optional and
 * no AI runs: photos land in Unsorted until the user creates entries.
 */
export function BatchCaptureDialog({ open, onOpenChange }: BatchCaptureDialogProps) {
  const { toast } = useToast();
  const { data: sessions = [] } = useQuery<SessionSummary[]>({ queryKey: SESSIONS_KEY, enabled: open });
  const [sessionId, setSessionId] = useState<string>("new");
  const [title, setTitle] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [context, setContext] = useState<Record<ContextKey, string>>({ location: "", container: "", category: "", purpose: "" });
  const [uploading, setUploading] = useState(false);

  const reset = () => {
    setFiles([]);
    setContext({ location: "", container: "", category: "", purpose: "" });
    setTitle("");
  };

  const upload = async () => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      let targetSession = sessionId;
      if (targetSession === "new") {
        const response = await apiRequest("POST", "/api/capture-sessions", { title: title.trim() || undefined });
        targetSession = (await response.json()).id;
        setSessionId(targetSession);
      }
      for (let start = 0; start < files.length; start += CHUNK_SIZE) {
        const form = new FormData();
        files.slice(start, start + CHUNK_SIZE).forEach((file) => form.append("photos", file));
        Object.entries(context).forEach(([key, value]) => value.trim() && form.append(key, value.trim()));
        await apiRequest("POST", `/api/capture-sessions/${targetSession}/batches`, form);
      }
      await invalidateCaptureQueries();
      toast({
        title: "Photos captured",
        description: `${files.length} photo${files.length === 1 ? "" : "s"} added to Unsorted. Create items from them whenever you like.`,
      });
      reset();
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message.replace(/^\d+: /, "") : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !uploading && onOpenChange(next)}>
      <DialogContent className="max-w-lg" data-testid="dialog-batch-capture">
        <DialogHeader>
          <DialogTitle>Batch capture</DialogTitle>
          <DialogDescription>
            Add many photos at once. Nothing is identified yet; photos wait in Unsorted. Context is optional.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="batch-files">Photos</Label>
            <Input
              id="batch-files"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              data-testid="input-batch-files"
            />
            {files.length > 0 && (
              <p className="text-xs text-muted-foreground" data-testid="text-batch-count">
                {files.length} photo{files.length === 1 ? "" : "s"} selected
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="batch-session">Session</Label>
            <select
              id="batch-session"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={sessionId}
              onChange={(event) => setSessionId(event.target.value)}
              data-testid="select-batch-session"
            >
              <option value="new">New session</option>
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.title} ({session.photoCount} photos)
                </option>
              ))}
            </select>
            {sessionId === "new" && (
              <Input
                placeholder="Session name (optional)"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                data-testid="input-session-title"
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {CONTEXT_FIELDS.map((field) => (
              <div key={field.key} className="space-y-1">
                <Label htmlFor={`batch-${field.key}`} className="text-xs">
                  {field.label}
                </Label>
                <Input
                  id={`batch-${field.key}`}
                  placeholder={field.placeholder}
                  value={context[field.key]}
                  onChange={(event) => setContext({ ...context, [field.key]: event.target.value })}
                  data-testid={`input-batch-${field.key}`}
                />
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={upload}
            disabled={files.length === 0 || uploading}
            data-testid="button-batch-upload"
          >
            {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Images className="w-4 h-4 mr-2" />}
            Add {files.length || ""} photo{files.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
