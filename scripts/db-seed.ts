import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { inventoryItems } from "../shared/schema";
import 'dotenv/config';

/**
 * Seed test database with deterministic test data
 * Uses DATABASE_URL_TEST if available, otherwise DATABASE_URL
 */
async function seedDatabase() {
  const databaseUrl = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL or DATABASE_URL_TEST environment variable is required");
  }

  console.log('🌱 Seeding database...');

  const sqlClient = neon(databaseUrl);
  const db = drizzle(sqlClient);

  const testItems = [
    {
      id: 'test-item-1',
      name: 'Vintage Camera',
      description: 'A classic 35mm film camera from the 1970s in excellent condition',
      category: 'Electronics',
      tags: ['vintage', 'photography', 'collectible'],
      imageUrl: '/objects/items/test-camera.jpg',
      barcodeData: 'INV-TEST-001',
      estimatedValue: '250.00',
      valueConfidence: 'high',
      valueRationale: 'Based on recent eBay sales of similar vintage cameras',
      createdAt: new Date('2025-01-01T10:00:00Z').toISOString(),
    },
    {
      id: 'test-item-2',
      name: 'Office Chair',
      description: 'Ergonomic office chair with lumbar support and adjustable armrests',
      category: 'Furniture',
      tags: ['office', 'ergonomic', 'furniture'],
      imageUrl: '/objects/items/test-chair.jpg',
      barcodeData: 'INV-TEST-002',
      estimatedValue: '150.00',
      valueConfidence: 'medium',
      valueRationale: 'Typical price range for used ergonomic office chairs',
      createdAt: new Date('2025-01-02T10:00:00Z').toISOString(),
    },
    {
      id: 'test-item-3',
      name: 'Laptop',
      description: 'MacBook Pro 2020 with 16GB RAM and 512GB SSD',
      category: 'Electronics',
      tags: ['laptop', 'apple', 'computer'],
      imageUrl: '/objects/items/test-laptop.jpg',
      barcodeData: 'INV-TEST-003',
      estimatedValue: '800.00',
      valueConfidence: 'high',
      valueRationale: 'Current market value for used 2020 MacBook Pro',
      createdAt: new Date('2025-01-03T10:00:00Z').toISOString(),
    },
    {
      id: 'test-item-broken-image',
      name: 'Test Item with Broken Image',
      description: 'This item is used to test image fallback functionality',
      category: 'Test',
      tags: ['test', 'fallback'],
      imageUrl: '/objects/items/nonexistent-image.jpg',
      barcodeData: 'INV-TEST-BROKEN',
      estimatedValue: '10.00',
      valueConfidence: 'low',
      valueRationale: 'Test item',
      createdAt: new Date('2025-01-04T10:00:00Z').toISOString(),
    },
  ];

  try {
    for (const item of testItems) {
      await db.insert(inventoryItems).values(item);
      console.log(`✓ Inserted: ${item.name}`);
    }

    console.log(`✅ Seeded ${testItems.length} test items`);
  } catch (error) {
    console.error('❌ Database seeding failed:', error);
    process.exit(1);
  }
}

seedDatabase();
