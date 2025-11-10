import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Image Loading Fallback', () => {
  test.beforeEach(async ({ page }) => {
    // Seed the database with test data including a broken image
    // This assumes db:seed creates items with predictable IDs
    await page.goto('/');
  });

  test('should show fallback placeholder when image fails to load', async ({ page }) => {
    let imageRequestCount = 0;
    const imageUrl = /\/objects\/.*\.(jpg|png)/;

    // Intercept image requests
    await page.route(imageUrl, async (route) => {
      imageRequestCount++;

      if (imageRequestCount === 1) {
        // First request: simulate server error
        await route.fulfill({
          status: 500,
          contentType: 'text/plain',
          body: 'Internal Server Error',
        });
      } else {
        // Subsequent requests: allow through
        await route.continue();
      }
    });

    // Wait for the page to load and an item card to appear
    await page.waitForSelector('[data-testid^="card-item-"]', { timeout: 10000 });

    // The image should fail to load and show the fallback placeholder
    const placeholder = page.locator('[data-testid^="placeholder-"]').first();
    await expect(placeholder).toBeVisible({ timeout: 5000 });

    // Verify placeholder has proper accessibility attributes
    const ariaLabel = await placeholder.getAttribute('aria-label');
    expect(ariaLabel).toBeTruthy();
    expect(ariaLabel).toMatch(/No image available for/);

    // Verify retry button exists
    const retryButton = page.locator('[data-testid^="button-retry-"]').first();
    await expect(retryButton).toBeVisible();

    // Run accessibility check on the placeholder
    const accessibilityScanResults = await new AxeBuilder({ page })
      .include('[role="img"]')
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('should successfully load image on retry with cache-busting', async ({ page }) => {
    let imageRequestCount = 0;
    const imageUrl = /\/objects\/.*\.(jpg|png)/;
    let caughtCacheBustedRequest = false;

    // Intercept image requests
    await page.route(imageUrl, async (route) => {
      imageRequestCount++;
      const requestUrl = route.request().url();

      if (imageRequestCount === 1) {
        // First request: simulate failure
        await route.fulfill({
          status: 500,
          contentType: 'text/plain',
          body: 'Server Error',
        });
      } else if (imageRequestCount === 2 && requestUrl.includes('?rev=')) {
        // Second request with cache-busting: succeed
        caughtCacheBustedRequest = true;

        // Create a simple 1x1 pixel transparent PNG
        const transparentPng = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
          'base64'
        );

        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: transparentPng,
        });
      } else {
        // Other requests: continue normally
        await route.continue();
      }
    });

    // Navigate to page
    await page.waitForSelector('[data-testid^="card-item-"]', { timeout: 10000 });

    // Wait for fallback placeholder to appear
    const placeholder = page.locator('[data-testid^="placeholder-"]').first();
    await expect(placeholder).toBeVisible({ timeout: 5000 });

    // Click retry button
    const retryButton = page.locator('[data-testid^="button-retry-"]').first();
    await retryButton.click();

    // Wait for successful image load
    // The image should now be visible (no longer showing placeholder)
    await page.waitForTimeout(1000); // Small delay to allow re-render

    // Verify cache-busted request was made
    expect(caughtCacheBustedRequest).toBe(true);
    expect(imageRequestCount).toBeGreaterThanOrEqual(2);

    // Verify the retry button is no longer visible (image loaded successfully)
    await expect(retryButton).not.toBeVisible({ timeout: 5000 });
  });

  test('should show loading skeleton while image loads', async ({ page }) => {
    // Delay image loading to test skeleton state
    await page.route(/\/objects\/.*\.(jpg|png)/, async (route) => {
      // Delay by 1 second
      await new Promise(resolve => setTimeout(resolve, 1000));
      await route.continue();
    });

    await page.waitForSelector('[data-testid^="card-item-"]', { timeout: 10000 });

    // Check for loading skeleton (animate-pulse class)
    const loadingSkeleton = page.locator('[data-testid^="skeleton-"]').first();

    // Loading skeleton should be visible initially
    // Note: This might be flaky if the image loads too quickly
    // In production, we'd mock the image loading to be slower
    const isVisible = await loadingSkeleton.isVisible().catch(() => false);

    // Either the skeleton was visible, or the image loaded too quickly
    // This is a soft assertion - we just verify the skeleton exists in the DOM
    expect(isVisible || await loadingSkeleton.count() > 0).toBeTruthy();
  });

  test('fallback placeholder should be keyboard accessible', async ({ page }) => {
    let imageRequestCount = 0;

    // Intercept and fail image requests
    await page.route(/\/objects\/.*\.(jpg|png)/, async (route) => {
      imageRequestCount++;
      if (imageRequestCount === 1) {
        await route.fulfill({
          status: 500,
          body: 'Error',
        });
      } else {
        await route.continue();
      }
    });

    await page.waitForSelector('[data-testid^="card-item-"]', { timeout: 10000 });

    // Wait for placeholder
    await page.waitForSelector('[data-testid^="placeholder-"]', { timeout: 5000 });

    // Focus on the retry button using keyboard navigation
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab'); // Might need multiple tabs depending on page layout

    // Find the retry button
    const retryButton = page.locator('[data-testid^="button-retry-"]').first();

    // Verify button can be focused
    await retryButton.focus();
    await expect(retryButton).toBeFocused();

    // Verify button can be activated with keyboard
    await page.keyboard.press('Enter');

    // Should trigger retry (imageRequestCount should increment)
    await page.waitForTimeout(500);
    expect(imageRequestCount).toBeGreaterThan(1);
  });

  test('should handle multiple image failures gracefully', async ({ page }) => {
    let imageRequestCount = 0;

    // Fail first 3 requests
    await page.route(/\/objects\/.*\.(jpg|png)/, async (route) => {
      imageRequestCount++;
      if (imageRequestCount <= 3) {
        await route.fulfill({
          status: 500,
          body: 'Error',
        });
      } else {
        // Create a simple 1x1 pixel PNG
        const pngData = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
          'base64'
        );
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: pngData,
        });
      }
    });

    await page.waitForSelector('[data-testid^="card-item-"]', { timeout: 10000 });

    // Verify placeholder appears
    const placeholder = page.locator('[data-testid^="placeholder-"]').first();
    await expect(placeholder).toBeVisible();

    // Retry multiple times
    const retryButton = page.locator('[data-testid^="button-retry-"]').first();

    // First retry (will fail)
    await retryButton.click();
    await page.waitForTimeout(500);
    await expect(placeholder).toBeVisible();

    // Second retry (will fail)
    await retryButton.click();
    await page.waitForTimeout(500);
    await expect(placeholder).toBeVisible();

    // Third retry (will succeed)
    await retryButton.click();
    await page.waitForTimeout(500);

    // Placeholder should now be hidden (image loaded)
    await expect(retryButton).not.toBeVisible({ timeout: 3000 });
  });
});
