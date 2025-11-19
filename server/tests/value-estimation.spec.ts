import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Value Estimation Tests (PRD 0006)
 *
 * These tests verify the automatic value estimation feature including:
 * - Model policy returns all value fields
 * - Value format validation
 * - Confidence validation
 * - Graceful fallback on errors
 */

// Mock the OpenAI clients
vi.mock('../openai', () => ({
  openaiCheap: {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  },
  openaiPremium: {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  },
}));

import {
  analyzeWithCheapModel,
  analyzeWithPremiumModel,
  analyzeImagePolicy,
  type AnalysisResult,
} from '../modelPolicy';
import { openaiCheap, openaiPremium } from '../openai';

describe('Value Estimation - Model Policy (PRD 0006)', () => {
  const mockImageBuffer = Buffer.from('fake-image-data');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('analyzeWithCheapModel()', () => {
    it('should return all value fields from AI response', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              name: 'Vintage Camera',
              description: 'A well-preserved 35mm film camera',
              category: 'Electronics',
              tags: ['camera', 'vintage', 'photography'],
              confidence: 0.85,
              estimatedValue: '125.00',
              valueConfidence: 'medium',
              valueRationale: 'Based on similar vintage cameras on eBay',
            }),
          },
        }],
      };

      vi.mocked(openaiCheap.chat.completions.create).mockResolvedValue(mockResponse as any);

      const result = await analyzeWithCheapModel(mockImageBuffer);

      expect(result.name).toBe('Vintage Camera');
      expect(result.description).toBe('A well-preserved 35mm film camera');
      expect(result.category).toBe('Electronics');
      expect(result.tags).toEqual(['camera', 'vintage', 'photography']);
      expect(result.confidence).toBe(0.85);
      expect(result.estimatedValue).toBe('125.00');
      expect(result.valueConfidence).toBe('medium');
      expect(result.valueRationale).toBe('Based on similar vintage cameras on eBay');
    });

    it('should normalize estimatedValue format (add .00 if missing)', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              name: 'Book',
              description: 'A paperback novel',
              category: 'Books',
              tags: ['book'],
              confidence: 0.9,
              estimatedValue: '5', // Missing decimals
              valueConfidence: 'high',
              valueRationale: 'Common paperback',
            }),
          },
        }],
      };

      vi.mocked(openaiCheap.chat.completions.create).mockResolvedValue(mockResponse as any);

      const result = await analyzeWithCheapModel(mockImageBuffer);

      expect(result.estimatedValue).toBe('5.00');
    });

    it('should return null for invalid estimatedValue format', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              name: 'Item',
              description: 'Test',
              category: 'Other',
              tags: [],
              confidence: 0.5,
              estimatedValue: 'not-a-number',
              valueConfidence: 'low',
              valueRationale: 'Test',
            }),
          },
        }],
      };

      vi.mocked(openaiCheap.chat.completions.create).mockResolvedValue(mockResponse as any);

      const result = await analyzeWithCheapModel(mockImageBuffer);

      expect(result.estimatedValue).toBeNull();
    });

    it('should return null for invalid valueConfidence', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              name: 'Item',
              description: 'Test',
              category: 'Other',
              tags: [],
              confidence: 0.5,
              estimatedValue: '50.00',
              valueConfidence: 'invalid-confidence',
              valueRationale: 'Test',
            }),
          },
        }],
      };

      vi.mocked(openaiCheap.chat.completions.create).mockResolvedValue(mockResponse as any);

      const result = await analyzeWithCheapModel(mockImageBuffer);

      expect(result.valueConfidence).toBeNull();
    });

    it('should use defaults for missing fields', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              // Minimal response with missing fields
              description: 'Some item',
            }),
          },
        }],
      };

      vi.mocked(openaiCheap.chat.completions.create).mockResolvedValue(mockResponse as any);

      const result = await analyzeWithCheapModel(mockImageBuffer);

      expect(result.name).toBe('Item');
      expect(result.category).toBe('Uncategorized');
      expect(result.tags).toEqual([]);
      expect(result.confidence).toBe(0.4);
      expect(result.estimatedValue).toBeNull();
      expect(result.valueConfidence).toBeNull();
      expect(result.valueRationale).toBeNull();
    });

    it('should throw error when no response from AI', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: null,
          },
        }],
      };

      vi.mocked(openaiCheap.chat.completions.create).mockResolvedValue(mockResponse as any);

      await expect(analyzeWithCheapModel(mockImageBuffer)).rejects.toThrow('No response from AI');
    });
  });

  describe('analyzeWithPremiumModel()', () => {
    it('should return all value fields from AI response', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              name: 'Antique Desk',
              description: 'Oak roll-top desk from early 1900s',
              category: 'Furniture',
              tags: ['antique', 'desk', 'oak', 'vintage'],
              confidence: 0.95,
              estimatedValue: '850.00',
              valueConfidence: 'high',
              valueRationale: 'Based on comparable antique furniture sales',
            }),
          },
        }],
      };

      vi.mocked(openaiPremium.chat.completions.create).mockResolvedValue(mockResponse as any);

      const result = await analyzeWithPremiumModel(mockImageBuffer);

      expect(result.name).toBe('Antique Desk');
      expect(result.estimatedValue).toBe('850.00');
      expect(result.valueConfidence).toBe('high');
      expect(result.valueRationale).toBe('Based on comparable antique furniture sales');
      expect(result.confidence).toBe(0.95);
    });

    it('should default to 0.9 confidence if not provided', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              name: 'Item',
              description: 'Test',
              category: 'Other',
              // No confidence provided
            }),
          },
        }],
      };

      vi.mocked(openaiPremium.chat.completions.create).mockResolvedValue(mockResponse as any);

      const result = await analyzeWithPremiumModel(mockImageBuffer);

      expect(result.confidence).toBe(0.9);
    });
  });

  describe('analyzeImagePolicy()', () => {
    it('should use cheap model result when confidence >= 0.4', async () => {
      const cheapResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              name: 'Phone',
              description: 'Smartphone',
              category: 'Electronics',
              tags: ['phone'],
              confidence: 0.6, // Above threshold
              estimatedValue: '200.00',
              valueConfidence: 'medium',
              valueRationale: 'Average used phone price',
            }),
          },
        }],
      };

      vi.mocked(openaiCheap.chat.completions.create).mockResolvedValue(cheapResponse as any);

      const result = await analyzeImagePolicy(mockImageBuffer);

      expect(result.name).toBe('Phone');
      expect(result.estimatedValue).toBe('200.00');
      // Premium model should not have been called
      expect(openaiPremium.chat.completions.create).not.toHaveBeenCalled();
    });

    it('should fallback to premium model when cheap confidence < 0.4', async () => {
      const cheapResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              name: 'Unknown',
              description: 'Cannot identify',
              category: 'Other',
              tags: [],
              confidence: 0.2, // Below threshold
              estimatedValue: '10.00',
              valueConfidence: 'low',
              valueRationale: 'Cannot identify item',
            }),
          },
        }],
      };

      const premiumResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              name: 'Rare Collectible',
              description: 'Limited edition figurine',
              category: 'Collectibles',
              tags: ['collectible', 'rare', 'figurine'],
              confidence: 0.9,
              estimatedValue: '450.00',
              valueConfidence: 'high',
              valueRationale: 'Recent eBay sold listings for same item',
            }),
          },
        }],
      };

      vi.mocked(openaiCheap.chat.completions.create).mockResolvedValue(cheapResponse as any);
      vi.mocked(openaiPremium.chat.completions.create).mockResolvedValue(premiumResponse as any);

      const result = await analyzeImagePolicy(mockImageBuffer);

      // Should return premium result
      expect(result.name).toBe('Rare Collectible');
      expect(result.estimatedValue).toBe('450.00');
      expect(result.confidence).toBe(0.9);
      // Both models should have been called
      expect(openaiCheap.chat.completions.create).toHaveBeenCalled();
      expect(openaiPremium.chat.completions.create).toHaveBeenCalled();
    });

    it('should use cheap model at exactly 0.4 confidence threshold', async () => {
      const cheapResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              name: 'Item',
              description: 'Borderline confidence',
              category: 'Other',
              tags: [],
              confidence: 0.4, // Exactly at threshold
              estimatedValue: '25.00',
              valueConfidence: 'low',
              valueRationale: 'Low confidence estimate',
            }),
          },
        }],
      };

      vi.mocked(openaiCheap.chat.completions.create).mockResolvedValue(cheapResponse as any);

      const result = await analyzeImagePolicy(mockImageBuffer);

      expect(result.confidence).toBe(0.4);
      expect(result.estimatedValue).toBe('25.00');
      // Premium should not be called at exactly 0.4
      expect(openaiPremium.chat.completions.create).not.toHaveBeenCalled();
    });
  });

  describe('Value Format Validation', () => {
    it('should accept valid decimal formats', async () => {
      const testCases = [
        { input: '0.00', expected: '0.00' },
        { input: '1.50', expected: '1.50' },
        { input: '100.00', expected: '100.00' },
        { input: '9999.99', expected: '9999.99' },
        { input: '50', expected: '50.00' },
      ];

      for (const testCase of testCases) {
        const mockResponse = {
          choices: [{
            message: {
              content: JSON.stringify({
                name: 'Test',
                description: 'Test',
                category: 'Other',
                tags: [],
                confidence: 0.5,
                estimatedValue: testCase.input,
                valueConfidence: 'medium',
                valueRationale: 'Test',
              }),
            },
          }],
        };

        vi.mocked(openaiCheap.chat.completions.create).mockResolvedValue(mockResponse as any);

        const result = await analyzeWithCheapModel(mockImageBuffer);
        expect(result.estimatedValue).toBe(testCase.expected);
      }
    });

    it('should reject invalid value formats', async () => {
      const invalidValues = [
        '$50.00',      // Currency symbol
        '50.000',     // Too many decimals
        '-10.00',     // Negative
        'fifty',      // Text
        '10,000.00',  // Comma separator
        '',           // Empty string
      ];

      for (const invalidValue of invalidValues) {
        const mockResponse = {
          choices: [{
            message: {
              content: JSON.stringify({
                name: 'Test',
                description: 'Test',
                category: 'Other',
                tags: [],
                confidence: 0.5,
                estimatedValue: invalidValue,
                valueConfidence: 'medium',
                valueRationale: 'Test',
              }),
            },
          }],
        };

        vi.mocked(openaiCheap.chat.completions.create).mockResolvedValue(mockResponse as any);

        const result = await analyzeWithCheapModel(mockImageBuffer);
        expect(result.estimatedValue).toBeNull();
      }
    });
  });

  describe('Confidence Level Validation', () => {
    it('should accept valid confidence levels', async () => {
      const validLevels = ['low', 'medium', 'high'];

      for (const level of validLevels) {
        const mockResponse = {
          choices: [{
            message: {
              content: JSON.stringify({
                name: 'Test',
                description: 'Test',
                category: 'Other',
                tags: [],
                confidence: 0.5,
                estimatedValue: '50.00',
                valueConfidence: level,
                valueRationale: 'Test',
              }),
            },
          }],
        };

        vi.mocked(openaiCheap.chat.completions.create).mockResolvedValue(mockResponse as any);

        const result = await analyzeWithCheapModel(mockImageBuffer);
        expect(result.valueConfidence).toBe(level);
      }
    });

    it('should reject invalid confidence levels', async () => {
      const invalidLevels = ['HIGH', 'Medium', 'very-high', 'unknown', ''];

      for (const level of invalidLevels) {
        const mockResponse = {
          choices: [{
            message: {
              content: JSON.stringify({
                name: 'Test',
                description: 'Test',
                category: 'Other',
                tags: [],
                confidence: 0.5,
                estimatedValue: '50.00',
                valueConfidence: level,
                valueRationale: 'Test',
              }),
            },
          }],
        };

        vi.mocked(openaiCheap.chat.completions.create).mockResolvedValue(mockResponse as any);

        const result = await analyzeWithCheapModel(mockImageBuffer);
        expect(result.valueConfidence).toBeNull();
      }
    });
  });
});
