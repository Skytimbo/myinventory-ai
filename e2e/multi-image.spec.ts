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

test.describe('Multi-Image Support (PRD 0004)', () => {
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

  test('should display image count badge for multi-image items', async ({ page }) => {
    // Stub API to return item with 3 images
    await page.route(/\/api\/items(\?.*)?$/, async route => {
      apiHits++;
      console.log(`[STUB] /api/items hit #${apiHits}`);

      const body = JSON.stringify([
        {
          id: "multi-test-1",
          name: "Multi-Image Item",
          description: "Item with 3 images",
          category: "Test",
          tags: ["multi-image"],
          imageUrl: "/objects/items/multi-test-1/0.jpg",
          imageUrls: [
            "/objects/items/multi-test-1/0.jpg",
            "/objects/items/multi-test-1/1.jpg",
            "/objects/items/multi-test-1/2.jpg"
          ],
          barcodeData: "MULTI-TEST-1",
          estimatedValue: "100.00",
          valueConfidence: "high",
          valueRationale: null,
          location: "Garage",
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

    // Verify image count badge is visible and shows correct count
    const badge = page.locator('[data-testid="badge-image-count-multi-test-1"]');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('3');

    // Verify badge has Images icon
    const badgeIcon = badge.locator('svg');
    await expect(badgeIcon).toBeVisible();
  });

  test('should NOT display image count badge for single-image items', async ({ page }) => {
    // Stub API to return item with single image (backwards compatibility)
    await page.route(/\/api\/items(\?.*)?$/, async route => {
      apiHits++;
      console.log(`[STUB] /api/items hit #${apiHits}`);

      const body = JSON.stringify([
        {
          id: "single-test-1",
          name: "Single-Image Item",
          description: "Legacy single-image item",
          category: "Test",
          tags: ["single-image"],
          imageUrl: "/objects/items/single-test-1.jpg",
          imageUrls: ["/objects/items/single-test-1.jpg"], // Lazy migration
          barcodeData: "SINGLE-TEST-1",
          estimatedValue: "50.00",
          valueConfidence: "medium",
          valueRationale: null,
          location: "Shed",
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

    // Verify image count badge is NOT visible (no badge for single image)
    const badge = page.locator('[data-testid="badge-image-count-single-test-1"]');
    await expect(badge).toHaveCount(0);
  });

  test('should display multi-image gallery in item detail modal', async ({ page }) => {
    // Stub API to return item with 3 images
    await page.route(/\/api\/items(\?.*)?$/, async route => {
      apiHits++;
      console.log(`[STUB] /api/items hit #${apiHits}`);

      const body = JSON.stringify([
        {
          id: "gallery-test-1",
          name: "Gallery Test Item",
          description: "Item for testing gallery",
          category: "Test",
          tags: [],
          imageUrl: "/objects/items/gallery-test-1/0.jpg",
          imageUrls: [
            "/objects/items/gallery-test-1/0.jpg",
            "/objects/items/gallery-test-1/1.jpg",
            "/objects/items/gallery-test-1/2.jpg"
          ],
          barcodeData: "GALLERY-TEST-1",
          estimatedValue: "200.00",
          valueConfidence: "high",
          valueRationale: null,
          location: "Office",
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
    await waitForCards(page);

    // Click on "View Full Size" button to open barcode modal (which now has gallery)
    const viewBarcodeButton = page.locator('[data-testid="button-view-barcode-gallery-test-1"]');
    await viewBarcodeButton.click();

    // Wait for modal to open
    const modal = page.locator('[data-testid="dialog-barcode"]');
    await expect(modal).toBeVisible();

    // Verify gallery is rendered
    const gallery = page.locator('[data-testid="multi-image-gallery"]');
    await expect(gallery).toBeVisible();

    // Verify primary image is displayed
    const primaryImage = page.locator('[data-testid="gallery-primary-0"]');
    await expect(primaryImage).toBeVisible();

    // Verify all 3 thumbnails are rendered
    const thumbnail0 = page.locator('[data-testid="gallery-thumbnail-0"]');
    const thumbnail1 = page.locator('[data-testid="gallery-thumbnail-1"]');
    const thumbnail2 = page.locator('[data-testid="gallery-thumbnail-2"]');
    await expect(thumbnail0).toBeVisible();
    await expect(thumbnail1).toBeVisible();
    await expect(thumbnail2).toBeVisible();

    // Verify image counter shows "1 / 3"
    const counter = page.locator('[data-testid="gallery-counter"]');
    await expect(counter).toContainText('1 / 3');
  });

  test('should switch primary image when clicking thumbnail', async ({ page }) => {
    // Stub API to return item with 3 images
    await page.route(/\/api\/items(\?.*)?$/, async route => {
      apiHits++;
      console.log(`[STUB] /api/items hit #${apiHits}`);

      const body = JSON.stringify([
        {
          id: "switch-test-1",
          name: "Switch Test Item",
          description: "Item for testing thumbnail switching",
          category: "Test",
          tags: [],
          imageUrl: "/objects/items/switch-test-1/0.jpg",
          imageUrls: [
            "/objects/items/switch-test-1/0.jpg",
            "/objects/items/switch-test-1/1.jpg",
            "/objects/items/switch-test-1/2.jpg"
          ],
          barcodeData: "SWITCH-TEST-1",
          estimatedValue: "150.00",
          valueConfidence: "medium",
          valueRationale: null,
          location: "Basement",
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
    await waitForCards(page);

    // Open modal
    const viewBarcodeButton = page.locator('[data-testid="button-view-barcode-switch-test-1"]');
    await viewBarcodeButton.click();

    // Wait for modal and gallery
    const modal = page.locator('[data-testid="dialog-barcode"]');
    await expect(modal).toBeVisible();

    // Verify initial state: primary image is index 0
    const primaryImage0 = page.locator('[data-testid="gallery-primary-0"]');
    await expect(primaryImage0).toBeVisible();

    // Verify counter shows "1 / 3"
    const counter = page.locator('[data-testid="gallery-counter"]');
    await expect(counter).toContainText('1 / 3');

    // Click second thumbnail
    const thumbnail1 = page.locator('[data-testid="gallery-thumbnail-1"]');
    await thumbnail1.click();

    // Wait for primary image to switch to index 1
    const primaryImage1 = page.locator('[data-testid="gallery-primary-1"]');
    await expect(primaryImage1).toBeVisible();

    // Verify counter updated to "2 / 3"
    await expect(counter).toContainText('2 / 3');

    // Verify first primary image is no longer displayed
    await expect(primaryImage0).toHaveCount(0);

    // Click third thumbnail
    const thumbnail2 = page.locator('[data-testid="gallery-thumbnail-2"]');
    await thumbnail2.click();

    // Wait for primary image to switch to index 2
    const primaryImage2 = page.locator('[data-testid="gallery-primary-2"]');
    await expect(primaryImage2).toBeVisible();

    // Verify counter updated to "3 / 3"
    await expect(counter).toContainText('3 / 3');

    // Verify second primary image is no longer displayed
    await expect(primaryImage1).toHaveCount(0);
  });

  test('should show simple image display for single-image items in modal', async ({ page }) => {
    // Stub API to return single-image item
    await page.route(/\/api\/items(\?.*)?$/, async route => {
      apiHits++;
      console.log(`[STUB] /api/items hit #${apiHits}`);

      const body = JSON.stringify([
        {
          id: "single-modal-test-1",
          name: "Single Modal Test",
          description: "Single-image item in modal",
          category: "Test",
          tags: [],
          imageUrl: "/objects/items/single-modal-test-1.jpg",
          imageUrls: ["/objects/items/single-modal-test-1.jpg"],
          barcodeData: "SINGLE-MODAL-1",
          estimatedValue: "75.00",
          valueConfidence: "low",
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
    await waitForCards(page);

    // Open modal
    const viewBarcodeButton = page.locator('[data-testid="button-view-barcode-single-modal-test-1"]');
    await viewBarcodeButton.click();

    // Wait for modal
    const modal = page.locator('[data-testid="dialog-barcode"]');
    await expect(modal).toBeVisible();

    // Verify multi-image gallery is NOT rendered
    const gallery = page.locator('[data-testid="multi-image-gallery"]');
    await expect(gallery).toHaveCount(0);

    // Verify simple single-image display is shown
    const singleImage = page.locator('[data-testid="single-image-display"]');
    await expect(singleImage).toBeVisible();

    // Verify no thumbnails or counter
    const thumbnails = page.locator('[data-testid="gallery-thumbnails"]');
    const counter = page.locator('[data-testid="gallery-counter"]');
    await expect(thumbnails).toHaveCount(0);
    await expect(counter).toHaveCount(0);
  });

  test('should handle backwards compatibility: legacy items without imageUrls', async ({ page }) => {
    // Stub API to return legacy item (only imageUrl, no imageUrls)
    await page.route(/\/api\/items(\?.*)?$/, async route => {
      apiHits++;
      console.log(`[STUB] /api/items hit #${apiHits} - legacy item`);

      const body = JSON.stringify([
        {
          id: "legacy-test-1",
          name: "Legacy Item",
          description: "Old item without imageUrls field",
          category: "Test",
          tags: ["legacy"],
          imageUrl: "/objects/items/legacy-test-1.jpg",
          // No imageUrls field - simulating pre-PRD-0004 item
          barcodeData: "LEGACY-TEST-1",
          estimatedValue: "30.00",
          valueConfidence: null,
          valueRationale: null,
          location: "Attic",
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

    // Verify card displays correctly (no badge for single image)
    const badge = page.locator('[data-testid="badge-image-count-legacy-test-1"]');
    await expect(badge).toHaveCount(0);

    // Verify item image loads
    const itemImage = page.locator('[data-testid="img-item-legacy-test-1"]');
    await expect(itemImage).toBeVisible();

    // Open modal
    const viewBarcodeButton = page.locator('[data-testid="button-view-barcode-legacy-test-1"]');
    await viewBarcodeButton.click();

    // Wait for modal
    const modal = page.locator('[data-testid="dialog-barcode"]');
    await expect(modal).toBeVisible();

    // Verify simple single-image display is shown (fallback for undefined imageUrls)
    const singleImage = page.locator('[data-testid="single-image-display"]');
    await expect(singleImage).toBeVisible();
  });
});
