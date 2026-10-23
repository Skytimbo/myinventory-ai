import { useState } from "react";
import type { InventoryItem } from "@shared/schema";
import {
  formatUsd,
  getIdentificationStatus,
  getValuationView,
  VALUE_STATUS_LABELS,
} from "@shared/valuation";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ValueSummaryProps {
  item: InventoryItem;
}

const UNCERTAINTY_LABELS = {
  low: "Low uncertainty",
  medium: "Some uncertainty",
  high: "High uncertainty",
} as const;

/**
 * Valuation and identification details for an item card.
 * Everything is inline (no hover-only tooltips) so it works on touch screens.
 */
export function ValueSummary({ item }: ValueSummaryProps) {
  const [showDetails, setShowDetails] = useState(false);
  const view = getValuationView(item);
  const valuation = view.valuation;
  const identificationStatus = getIdentificationStatus(item);
  const identification = item.identification;
  const legacy = view.legacy;
  const showLegacy = legacy && !legacy.isPlaceholder;

  return (
    <div className="space-y-1.5" data-testid={`value-summary-${item.id}`}>
      {valuation && view.status === "estimated" && (
        <div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <p
              className={cn(
                "text-base font-semibold font-mono text-foreground",
                view.isStale && "line-through text-muted-foreground"
              )}
              data-testid={`text-value-${item.id}`}
            >
              {formatUsd(valuation.low)} – {formatUsd(valuation.high)}
            </p>
            <span className="text-xs text-muted-foreground">
              likely {formatUsd(valuation.likely)}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge
              variant={valuation.confidence === "high" ? "default" : valuation.confidence === "medium" ? "secondary" : "outline"}
              className="text-xs"
              data-testid={`badge-confidence-${item.id}`}
            >
              {valuation.confidence ?? "low"} confidence
            </Badge>
            <Badge variant="outline" className="text-xs" data-testid={`badge-evidence-${item.id}`}>
              AI judgment
            </Badge>
          </div>
        </div>
      )}

      {valuation && view.status !== "estimated" && (
        <div>
          <Badge variant="outline" className="text-xs" data-testid={`badge-value-status-${item.id}`}>
            {VALUE_STATUS_LABELS[view.status]}
          </Badge>
          {view.status === "nonmarketable" && valuation.marketabilityReason && (
            <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
              {valuation.marketabilityReason}
            </p>
          )}
          {view.status === "insufficient_information" && valuation.missingInformation.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground" data-testid={`text-missing-info-${item.id}`}>
              Would help: {valuation.missingInformation.join(", ")}
            </p>
          )}
        </div>
      )}

      {!valuation && (
        <p className="text-sm text-muted-foreground" data-testid={`text-value-status-${item.id}`}>
          Value not evaluated
        </p>
      )}

      {view.isStale && (
        <p className="text-xs text-amber-700" data-testid={`text-stale-${item.id}`}>
          Stale: item was re-identified after this estimate. Not counted in totals.
        </p>
      )}

      {showLegacy && (
        <p className="text-xs text-muted-foreground" data-testid={`text-legacy-value-${item.id}`}>
          Legacy estimate {formatUsd(legacy.amount)} from the old combined analysis (unverified, not
          counted in totals)
        </p>
      )}

      <button
        type="button"
        onClick={() => setShowDetails(!showDetails)}
        className="text-xs text-blue-600 hover:underline"
        aria-expanded={showDetails}
        data-testid={`button-toggle-ai-details-${item.id}`}
      >
        {showDetails ? "Hide details" : "AI details"}
      </button>

      {showDetails && (
        <dl className="space-y-2 rounded-md bg-muted/50 p-2 text-xs" data-testid={`ai-details-${item.id}`}>
          <div>
            <dt className="font-semibold">Identification</dt>
            <dd className="text-muted-foreground">
              {identificationStatus === "unidentified" && "Not identified yet."}
              {identificationStatus === "legacy" && "Identified by the older combined analysis."}
              {identification && (
                <>
                  {UNCERTAINTY_LABELS[identification.uncertainty]}
                  {identification.notes && <>. {identification.notes}</>}
                  {identification.alternatives.length > 0 && (
                    <> Could also be: {identification.alternatives.join(", ")}.</>
                  )}
                </>
              )}
            </dd>
          </div>

          {valuation && (
            <div>
              <dt className="font-semibold">Valuation</dt>
              <dd className="space-y-1 text-muted-foreground">
                {valuation.marketabilityReason && <p>Marketability: {valuation.marketabilityReason}</p>}
                <p>{valuation.rationale}</p>
                {valuation.missingInformation.length > 0 && (
                  <p>Would help: {valuation.missingInformation.join(", ")}</p>
                )}
                <p data-testid={`text-evidence-note-${item.id}`}>{valuation.evidence.note}</p>
                <p>
                  Based on identification “{valuation.basedOn.name}”, evaluated{" "}
                  {new Date(valuation.evaluatedAt).toLocaleDateString()}.
                </p>
              </dd>
            </div>
          )}

          {legacy && (
            <div>
              <dt className="font-semibold">Legacy estimate</dt>
              <dd className="text-muted-foreground">
                {legacy.isPlaceholder
                  ? `Placeholder value ${formatUsd(legacy.amount)} with no confidence recorded; not a valuation.`
                  : `${formatUsd(legacy.amount)}${legacy.confidence ? `, ${legacy.confidence} confidence` : ""}. Produced by the old combined analysis; not verified under the current process.`}
                {legacy.rationale && !legacy.isPlaceholder && <> {legacy.rationale}</>}
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
