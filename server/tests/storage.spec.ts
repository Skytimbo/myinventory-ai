import { describe, it, expect, beforeEach } from 'vitest';
import { FakeDatabaseStorage } from '../services';
import type { InventoryItem } from '@shared/schema';

/**
 * Storage Lazy Migration Tests (PRD 0004)
 *
 * These tests verify the backwards-compatible lazy migration behavior
 * that populates imageUrls from imageUrl for legacy items.
 */
describe('Storage - Lazy Migration (PRD 0004)', () => {
  let storage: FakeDatabaseStorage;

  beforeEach(() => {
    storage = new FakeDatabaseStorage();
    storage.clear();
  });

  describe('getItem() lazy migration', () => {
    it('should populate imageUrls from imageUrl when null (legacy item)', async () => {
      // Create a legacy item without imageUrls
      const legacyItem: InventoryItem = {
        id: 'legacy-123',
        name: 'Legacy Camera',
        description: 'An old camera without multi-image support',
        category: 'Electronics',
        tags: ['camera', 'legacy'],
        imageUrl: '/objects/items/legacy-123.jpg',
        imageUrls: null,
        barcodeData: 'LEG123',
        estimatedValue: '150.00',
        valueConfidence: 'medium',
        valueRationale: 'Based on similar vintage cameras',
        location: 'Storage Room A',
        createdAt: '2024-01-15T10:00:00.000Z',
      };

      storage.seed([legacyItem]);

      // Retrieve via storage layer
      const item = await storage.getItem('legacy-123');

      // Verify lazy migration populated imageUrls
      expect(item).toBeDefined();
      expect(item?.imageUrls).toBeDefined();
      expect(item?.imageUrls).toEqual(['/objects/items/legacy-123.jpg']);
      // Original imageUrl should be preserved
      expect(item?.imageUrl).toBe('/objects/items/legacy-123.jpg');
    });

    it('should NOT modify existing imageUrls for multi-image items', async () => {
      // Create a multi-image item with existing imageUrls
      const multiImageItem: InventoryItem = {
        id: 'multi-456',
        name: 'Antique Desk',
        description: 'Multiple angles of antique desk',
        category: 'Furniture',
        tags: ['antique', 'furniture'],
        imageUrl: '/objects/items/multi-456/0.jpg',
        imageUrls: [
          '/objects/items/multi-456/0.jpg',
          '/objects/items/multi-456/1.jpg',
          '/objects/items/multi-456/2.jpg',
        ],
        barcodeData: 'DESK456',
        estimatedValue: '850.00',
        valueConfidence: 'high',
        valueRationale: 'Appraised by expert',
        location: 'Living Room',
        createdAt: '2024-06-20T14:30:00.000Z',
      };

      storage.seed([multiImageItem]);

      const item = await storage.getItem('multi-456');

      // Verify imageUrls was NOT modified
      expect(item).toBeDefined();
      expect(item?.imageUrls).toHaveLength(3);
      expect(item?.imageUrls).toEqual([
        '/objects/items/multi-456/0.jpg',
        '/objects/items/multi-456/1.jpg',
        '/objects/items/multi-456/2.jpg',
      ]);
    });

    it('should return undefined for non-existent items', async () => {
      const item = await storage.getItem('does-not-exist');
      expect(item).toBeUndefined();
    });
  });

  describe('getItems() lazy migration', () => {
    it('should populate imageUrls for all legacy items in batch', async () => {
      // Create multiple legacy items
      const legacyItems: InventoryItem[] = [
        {
          id: 'legacy-001',
          name: 'Legacy Item 1',
          description: 'First legacy item',
          category: 'Electronics',
          tags: ['legacy'],
          imageUrl: '/objects/items/legacy-001.jpg',
          imageUrls: null,
          barcodeData: 'LEG001',
          estimatedValue: '50.00',
          valueConfidence: 'low',
          valueRationale: 'Estimate',
          location: null,
          createdAt: '2024-01-10T10:00:00.000Z',
        },
        {
          id: 'legacy-002',
          name: 'Legacy Item 2',
          description: 'Second legacy item',
          category: 'Books',
          tags: ['legacy'],
          imageUrl: '/objects/items/legacy-002.png',
          imageUrls: null,
          barcodeData: 'LEG002',
          estimatedValue: '25.00',
          valueConfidence: 'medium',
          valueRationale: 'Common book',
          location: 'Shelf',
          createdAt: '2024-01-11T10:00:00.000Z',
        },
      ];

      storage.seed(legacyItems);

      const items = await storage.getItems();

      expect(items).toHaveLength(2);

      // All items should have imageUrls populated
      for (const item of items) {
        expect(item.imageUrls).toBeDefined();
        expect(item.imageUrls).toHaveLength(1);
        expect(item.imageUrls![0]).toBe(item.imageUrl);
      }
    });

    it('should handle mixed legacy and multi-image items correctly', async () => {
      const mixedItems: InventoryItem[] = [
        // Legacy item (no imageUrls)
        {
          id: 'legacy-001',
          name: 'Legacy Item',
          description: 'Old single-image item',
          category: 'Electronics',
          tags: [],
          imageUrl: '/objects/items/legacy-001.jpg',
          imageUrls: null,
          barcodeData: 'LEG001',
          estimatedValue: null,
          valueConfidence: null,
          valueRationale: null,
          location: null,
          createdAt: '2024-01-10T10:00:00.000Z',
        },
        // Multi-image item (has imageUrls)
        {
          id: 'multi-002',
          name: 'Multi Image Item',
          description: 'New multi-image item',
          category: 'Furniture',
          tags: [],
          imageUrl: '/objects/items/multi-002/0.jpg',
          imageUrls: [
            '/objects/items/multi-002/0.jpg',
            '/objects/items/multi-002/1.jpg',
          ],
          barcodeData: 'MULTI002',
          estimatedValue: '200.00',
          valueConfidence: 'high',
          valueRationale: 'Priced',
          location: null,
          createdAt: '2024-06-15T10:00:00.000Z',
        },
        // Another legacy item
        {
          id: 'legacy-003',
          name: 'Another Legacy',
          description: 'Another old item',
          category: 'Clothing',
          tags: [],
          imageUrl: '/objects/items/legacy-003.webp',
          imageUrls: null,
          barcodeData: 'LEG003',
          estimatedValue: '30.00',
          valueConfidence: 'low',
          valueRationale: null,
          location: 'Closet',
          createdAt: '2024-02-20T10:00:00.000Z',
        },
      ];

      storage.seed(mixedItems);

      const items = await storage.getItems();

      expect(items).toHaveLength(3);

      // Find each item and verify its imageUrls
      const legacy001 = items.find(i => i.id === 'legacy-001');
      const multi002 = items.find(i => i.id === 'multi-002');
      const legacy003 = items.find(i => i.id === 'legacy-003');

      // Legacy items should have imageUrls populated from imageUrl
      expect(legacy001?.imageUrls).toEqual(['/objects/items/legacy-001.jpg']);
      expect(legacy003?.imageUrls).toEqual(['/objects/items/legacy-003.webp']);

      // Multi-image item should retain its original imageUrls
      expect(multi002?.imageUrls).toHaveLength(2);
      expect(multi002?.imageUrls).toEqual([
        '/objects/items/multi-002/0.jpg',
        '/objects/items/multi-002/1.jpg',
      ]);
    });

    it('should return empty array when no items exist', async () => {
      const items = await storage.getItems();
      expect(items).toEqual([]);
    });

    it('should return items sorted by createdAt descending (newest first)', async () => {
      const items: InventoryItem[] = [
        {
          id: 'old-item',
          name: 'Old Item',
          description: 'Created first',
          category: 'Test',
          tags: [],
          imageUrl: '/objects/items/old.jpg',
          imageUrls: null,
          barcodeData: 'OLD',
          estimatedValue: null,
          valueConfidence: null,
          valueRationale: null,
          location: null,
          createdAt: '2024-01-01T00:00:00.000Z',
        },
        {
          id: 'new-item',
          name: 'New Item',
          description: 'Created last',
          category: 'Test',
          tags: [],
          imageUrl: '/objects/items/new.jpg',
          imageUrls: null,
          barcodeData: 'NEW',
          estimatedValue: null,
          valueConfidence: null,
          valueRationale: null,
          location: null,
          createdAt: '2024-12-01T00:00:00.000Z',
        },
        {
          id: 'mid-item',
          name: 'Mid Item',
          description: 'Created middle',
          category: 'Test',
          tags: [],
          imageUrl: '/objects/items/mid.jpg',
          imageUrls: null,
          barcodeData: 'MID',
          estimatedValue: null,
          valueConfidence: null,
          valueRationale: null,
          location: null,
          createdAt: '2024-06-01T00:00:00.000Z',
        },
      ];

      storage.seed(items);

      const result = await storage.getItems();

      // Should be sorted newest first
      expect(result[0].id).toBe('new-item');
      expect(result[1].id).toBe('mid-item');
      expect(result[2].id).toBe('old-item');
    });
  });

  describe('createItem() with imageUrls', () => {
    it('should create item with imageUrls preserved', async () => {
      const newItem = await storage.createItem({
        name: 'New Multi-Image Item',
        description: 'Created with multiple images',
        category: 'Art',
        tags: ['painting', 'gallery'],
        imageUrl: '/objects/items/new-art/0.jpg',
        imageUrls: [
          '/objects/items/new-art/0.jpg',
          '/objects/items/new-art/1.jpg',
          '/objects/items/new-art/2.jpg',
        ],
        barcodeData: 'ART001',
        estimatedValue: '500.00',
        valueConfidence: 'medium',
        valueRationale: 'Estimated by artist',
        location: 'Gallery Wall',
      });

      expect(newItem.id).toBeDefined();
      expect(newItem.createdAt).toBeDefined();
      expect(newItem.imageUrls).toHaveLength(3);

      // Retrieve and verify
      const retrieved = await storage.getItem(newItem.id);
      expect(retrieved?.imageUrls).toEqual([
        '/objects/items/new-art/0.jpg',
        '/objects/items/new-art/1.jpg',
        '/objects/items/new-art/2.jpg',
      ]);
    });

    it('should handle createItem without imageUrls (single image)', async () => {
      const newItem = await storage.createItem({
        name: 'Single Image Item',
        description: 'Created without imageUrls',
        category: 'Tools',
        tags: [],
        imageUrl: '/objects/items/tool.jpg',
        // imageUrls not provided
        barcodeData: 'TOOL001',
        estimatedValue: null,
        valueConfidence: null,
        valueRationale: null,
        location: null,
      });

      // Should be created with undefined/null imageUrls
      expect(newItem.id).toBeDefined();

      // When retrieved, lazy migration should populate imageUrls
      const retrieved = await storage.getItem(newItem.id);
      expect(retrieved?.imageUrls).toEqual(['/objects/items/tool.jpg']);
    });
  });
});
