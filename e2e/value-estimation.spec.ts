import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { wireNetworkDebug } from './utils/net';

// Helper: 1x1 transparent PNG for image stub
const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABJ7n8iQAAAABJRU5ErkJggg==",
  "base64"
);

// Helper: Wait for cards to render
async function waitForCards(page: Page) {
  const cards = page.locator('[data-testid^="card-item-"]');
  await expect.poll(async () => await cards.count(), { timeout: 15000 }).toBeGreaterThan(0);
  return cards;
}

const IDENTIFICATION = {
  confidence: 0.9,
  uncertainty: "low",
  notes: null,
  alternatives: [],
  model: "gpt-4o-mini",
  identifiedAt: "2026-10-20T00:00:00.000Z",
  promptVersion: "identify-v1",
};

function valuation(overrides: Record<string, unknown> = {}) {
  return {
    status: "estimated",
    marketability: "marketable",
    marketabilityReason: "Synthetic marketability",
    currency: "USD",
    low: "40.00",
    likely: "55.00",
    high: "70.00",
    confidence: "medium",
    rationale: "Synthetic rationale",
    missingInformation: [],
    evidence: {
      basis: "model_judgment",
      note: "AI judgment from the photos and identification. No marketplace or sales data was retrieved.",
    },
    basedOn: { name: "Synthetic", category: "Tools", identifiedAt: IDENTIFICATION.identifiedAt },
    model: "gpt-4o",
    evaluatedAt: "2026-10-21T00:00:00.000Z",
    promptVersion: "valuation-v1",
    staleAt: null,
    staleReason: null,
    ...overrides,
  };
}

function item(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Item ${id}`,
    description: "Synthetic item",
    category: "Tools",
    tags: [],
    imageUrl: `/objects/items/${id}.jpg`,
    imageUrls: [`/objects/items/${id}.jpg`],
    barcodeData: `BC-${id}`,
    estimatedValue: null,
    valueConfidence: null,
    valueRationale: null,
    location: null,
    analysisMetadata: { model: "gpt-4o-mini" },
    identification: IDENTIFICATION,
    valuation: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

async function stubItems(page: Page, items: unknown[]) {
  await page.route(/\/api\/items(\?.*)?$/, async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(items),
    });
  });
  await page.reload();
  await waitForCards(page);
}

test.describe('Identify / Estimate Value display (migration 0003)', () => {
  test.beforeEach(async ({ page }) => {
    // Enable network debugging
    wireNetworkDebug(page);

    // Stub image requests to succeed quickly
    await page.route(/\/objects\/items\/.*\.(jpg|png|webp)(\?.*)?$/, async route => {
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: ONE_BY_ONE_PNG
      });
    });

    // Navigate to app
    await page.goto('/');

    // Verify correct server
    const currentUrl = new URL(page.url());
    const expectedPort = process.env.CI ? '5000' : '5173';
    expect(currentUrl.port).toBe(expectedPort);
    expect(currentUrl.hostname).toBe('localhost');
  });

  test('shows a current estimate as a range with AI-judgment evidence', async ({ page }) => {
    await stubItems(page, [item("current", { valuation: valuation() })]);

    const card = page.locator('[data-testid="card-item-current"]');
    await expect(card.getByTestId("text-value-current")).toContainText("$40.00 – $70.00");
    await expect(card.getByTestId("badge-evidence-current")).toContainText("AI judgment");

    await card.getByTestId("button-toggle-ai-details-current").click();
    await expect(card.getByTestId("text-evidence-note-current")).toContainText(
      "No marketplace or sales data was retrieved"
    );
  });

  test('shows legacy values with provenance and not as current estimates', async ({ page }) => {
    await stubItems(page, [
      item("legacy", {
        identification: null,
        analysisMetadata: { model: "openai" },
        estimatedValue: "125.00",
        valueConfidence: "medium",
        valueRationale: "Based on similar vintage cameras on eBay",
      }),
    ]);

    const card = page.locator('[data-testid="card-item-legacy"]');
    await expect(card.getByTestId("text-value-status-legacy")).toContainText("Value not evaluated");
    await expect(card.getByTestId("text-legacy-value-legacy")).toContainText("Legacy estimate $125.00");
    await expect(page.getByTestId("stat-total-value")).toHaveText("—");
  });

  test('never shows a price for nonmarketable or unestablished values', async ({ page }) => {
    await stubItems(page, [
      item("rock", {
        name: "River rock",
        valuation: valuation({
          status: "nonmarketable",
          marketability: "nonmarketable",
          low: null,
          likely: null,
          high: null,
          confidence: null,
        }),
      }),
      item("antique", {
        valuation: valuation({
          status: "insufficient_information",
          marketability: "uncertain",
          low: null,
          likely: null,
          high: null,
          confidence: null,
          missingInformation: ["maker's mark"],
        }),
      }),
    ]);

    const rock = page.locator('[data-testid="card-item-rock"]');
    await expect(rock.getByTestId("badge-value-status-rock")).toContainText("No resale market");
    await expect(rock).not.toContainText("$");

    const antique = page.locator('[data-testid="card-item-antique"]');
    await expect(antique.getByTestId("text-missing-info-antique")).toContainText("maker's mark");
    await expect(antique).not.toContainText("$");
  });

  test('totals only current, non-stale estimates', async ({ page }) => {
    await stubItems(page, [
      item("a", { valuation: valuation({ likely: "100.00" }) }),
      item("b", { valuation: valuation({ likely: "50.00" }) }),
      item("stale", { valuation: valuation({ likely: "900.00", staleAt: "2026-10-22T00:00:00.000Z" }) }),
      item("legacy", { identification: null, estimatedValue: "300.00", valueConfidence: "high" }),
      item("none"),
    ]);

    await expect(page.getByTestId("stat-total-value")).toHaveText("$150.00");
    await expect(page.getByTestId("stat-total-value-detail")).toContainText("2 of 5 items estimated");
    await expect(page.locator('[data-testid="card-item-stale"]').getByTestId("text-stale-stale")).toBeVisible();
  });
});
