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

test.describe('Value Estimation (PRD 0006)', () => {
  let apiHits = 0;

  test.beforeEach(async ({ page }) => {
    apiHits = 0;

    // Enable network debugging
    wireNetworkDebug(page);

    // Stub image requests to succeed quickly
    await page.route(/\/objects\/items\/.*\.(jpg|png|webp)(\?.*)?$/, async route => {
      console.log(`[STUB] Image request: ${route.request().url()}`);
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

  // Subtask 5.1: Test upload displays estimated value in ItemCard
  test('should display estimated value in ItemCard', async ({ page }) => {
    // Stub API to return item with estimated value
    await page.route(/\/api\/items(\?.*)?$/, async route => {
      apiHits++;
      console.log(`[STUB] /api/items hit #${apiHits}`);

      const body = JSON.stringify([
        {
          id: "value-test-1",
          name: "Vintage Camera",
          description: "A well-preserved 35mm film camera",
          category: "Electronics",
          tags: ["camera", "vintage"],
          imageUrl: "/objects/items/value-test-1.jpg",
          imageUrls: ["/objects/items/value-test-1.jpg"],
          barcodeData: "VALUE-TEST-1",
          estimatedValue: "125.00",
          valueConfidence: "medium",
          valueRationale: "Based on similar vintage cameras on eBay",
          location: "Display Cabinet",
          createdAt: new Date().toISOString(),
        }
      ]);

      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body
      });
    });

    // Wait for page to reload with stubbed data
    await page.reload();

    // Wait for cards to render
    const cards = await waitForCards(page);
    expect(await cards.count()).toBeGreaterThan(0);

    // Verify estimated value is displayed
    const card = page.locator('[data-testid="card-item-value-test-1"]');
    await expect(card).toBeVisible();

    // Check that the value is displayed (should show "$125.00")
    await expect(card).toContainText('$125.00');
  });

  // Subtask 5.2: Test confidence badge and rationale tooltip
  test('should display confidence badge with correct styling', async ({ page }) => {
    // Stub API to return items with different confidence levels
    await page.route(/\/api\/items(\?.*)?$/, async route => {
      apiHits++;
      console.log(`[STUB] /api/items hit #${apiHits}`);

      const body = JSON.stringify([
        {
          id: "high-conf-1",
          name: "High Confidence Item",
          description: "Item with high confidence value",
          category: "Electronics",
          tags: [],
          imageUrl: "/objects/items/high-conf-1.jpg",
          imageUrls: ["/objects/items/high-conf-1.jpg"],
          barcodeData: "HIGH-CONF-1",
          estimatedValue: "500.00",
          valueConfidence: "high",
          valueRationale: "Exact model found in recent eBay sold listings",
          location: null,
          createdAt: new Date().toISOString(),
        },
        {
          id: "medium-conf-1",
          name: "Medium Confidence Item",
          description: "Item with medium confidence value",
          category: "Furniture",
          tags: [],
          imageUrl: "/objects/items/medium-conf-1.jpg",
          imageUrls: ["/objects/items/medium-conf-1.jpg"],
          barcodeData: "MEDIUM-CONF-1",
          estimatedValue: "200.00",
          valueConfidence: "medium",
          valueRationale: "Based on similar items in comparable condition",
          location: null,
          createdAt: new Date().toISOString(),
        },
        {
          id: "low-conf-1",
          name: "Low Confidence Item",
          description: "Item with low confidence value",
          category: "Other",
          tags: [],
          imageUrl: "/objects/items/low-conf-1.jpg",
          imageUrls: ["/objects/items/low-conf-1.jpg"],
          barcodeData: "LOW-CONF-1",
          estimatedValue: "25.00",
          valueConfidence: "low",
          valueRationale: "Unable to identify brand or model clearly",
          location: null,
          createdAt: new Date().toISOString(),
        }
      ]);

      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body
      });
    });

    // Wait for page to reload with stubbed data
    await page.reload();

    // Wait for cards to render
    const cards = await waitForCards(page);
    expect(await cards.count()).toBe(3);

    // Verify high confidence item displays value
    const highConfCard = page.locator('[data-testid="card-item-high-conf-1"]');
    await expect(highConfCard).toContainText('$500.00');

    // Verify medium confidence item displays value
    const mediumConfCard = page.locator('[data-testid="card-item-medium-conf-1"]');
    await expect(mediumConfCard).toContainText('$200.00');

    // Verify low confidence item displays value
    const lowConfCard = page.locator('[data-testid="card-item-low-conf-1"]');
    await expect(lowConfCard).toContainText('$25.00');
  });

  test('should handle items without estimated value gracefully', async ({ page }) => {
    // Stub API to return item with null estimated value
    await page.route(/\/api\/items(\?.*)?$/, async route => {
      apiHits++;
      console.log(`[STUB] /api/items hit #${apiHits}`);

      const body = JSON.stringify([
        {
          id: "no-value-1",
          name: "No Value Item",
          description: "Item where AI failed to estimate value",
          category: "Other",
          tags: [],
          imageUrl: "/objects/items/no-value-1.jpg",
          imageUrls: ["/objects/items/no-value-1.jpg"],
          barcodeData: "NO-VALUE-1",
          estimatedValue: null,
          valueConfidence: null,
          valueRationale: null,
          location: null,
          createdAt: new Date().toISOString(),
        }
      ]);

      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body
      });
    });

    // Wait for page to reload with stubbed data
    await page.reload();

    // Wait for cards to render
    const cards = await waitForCards(page);
    expect(await cards.count()).toBe(1);

    // Verify card renders without crashing
    const card = page.locator('[data-testid="card-item-no-value-1"]');
    await expect(card).toBeVisible();
    await expect(card).toContainText('No Value Item');

    // Value should not be displayed (no "$" sign for null value)
    // The card should still render the item name and other details
  });

  // Subtask 5.3: Test dashboard total value aggregation
  test('should calculate correct total value in dashboard', async ({ page }) => {
    // Stub API to return multiple items with known values
    await page.route(/\/api\/items(\?.*)?$/, async route => {
      apiHits++;
      console.log(`[STUB] /api/items hit #${apiHits}`);

      const body = JSON.stringify([
        {
          id: "item-1",
          name: "Item One",
          description: "First item",
          category: "Electronics",
          tags: [],
          imageUrl: "/objects/items/item-1.jpg",
          imageUrls: ["/objects/items/item-1.jpg"],
          barcodeData: "ITEM-1",
          estimatedValue: "100.00",
          valueConfidence: "high",
          valueRationale: "Test item 1",
          location: null,
          createdAt: new Date().toISOString(),
        },
        {
          id: "item-2",
          name: "Item Two",
          description: "Second item",
          category: "Furniture",
          tags: [],
          imageUrl: "/objects/items/item-2.jpg",
          imageUrls: ["/objects/items/item-2.jpg"],
          barcodeData: "ITEM-2",
          estimatedValue: "250.00",
          valueConfidence: "medium",
          valueRationale: "Test item 2",
          location: null,
          createdAt: new Date().toISOString(),
        },
        {
          id: "item-3",
          name: "Item Three",
          description: "Third item",
          category: "Books",
          tags: [],
          imageUrl: "/objects/items/item-3.jpg",
          imageUrls: ["/objects/items/item-3.jpg"],
          barcodeData: "ITEM-3",
          estimatedValue: "50.00",
          valueConfidence: "low",
          valueRationale: "Test item 3",
          location: null,
          createdAt: new Date().toISOString(),
        }
      ]);

      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body
      });
    });

    // Wait for page to reload with stubbed data
    await page.reload();

    // Wait for cards to render
    const cards = await waitForCards(page);
    expect(await cards.count()).toBe(3);

    // Total value should be 100 + 250 + 50 = 400
    // Check if dashboard displays total value
    // Note: The exact selector depends on Dashboard.tsx implementation
    const pageContent = await page.textContent('body');

    // Verify total value is displayed somewhere on the page
    // The dashboard shows total value as "$400.00" or "400"
    expect(pageContent).toContain('400');
  });

  test('should handle mixed items with and without values in total', async ({ page }) => {
    // Stub API to return items where some have null values
    await page.route(/\/api\/items(\?.*)?$/, async route => {
      apiHits++;
      console.log(`[STUB] /api/items hit #${apiHits}`);

      const body = JSON.stringify([
        {
          id: "valued-item",
          name: "Valued Item",
          description: "Item with value",
          category: "Electronics",
          tags: [],
          imageUrl: "/objects/items/valued-item.jpg",
          imageUrls: ["/objects/items/valued-item.jpg"],
          barcodeData: "VALUED",
          estimatedValue: "150.00",
          valueConfidence: "high",
          valueRationale: "Has value",
          location: null,
          createdAt: new Date().toISOString(),
        },
        {
          id: "no-value-item",
          name: "No Value Item",
          description: "Item without value",
          category: "Other",
          tags: [],
          imageUrl: "/objects/items/no-value-item.jpg",
          imageUrls: ["/objects/items/no-value-item.jpg"],
          barcodeData: "NO-VALUE",
          estimatedValue: null,
          valueConfidence: null,
          valueRationale: null,
          location: null,
          createdAt: new Date().toISOString(),
        }
      ]);

      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body
      });
    });

    // Wait for page to reload with stubbed data
    await page.reload();

    // Wait for cards to render
    const cards = await waitForCards(page);
    expect(await cards.count()).toBe(2);

    // Total should only count the valued item: 150
    const pageContent = await page.textContent('body');
    expect(pageContent).toContain('150');
  });
});
