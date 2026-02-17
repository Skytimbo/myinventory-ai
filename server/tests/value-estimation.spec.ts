import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIAnalyzer } from '../analyzer';

/**
 * Value Estimation Tests (PRD 0006)
 *
 * These tests verify the automatic value estimation feature including:
 * - OpenAIAnalyzer returns all value fields
 * - Value format validation
 * - Confidence validation
 * - Graceful fallback on errors
 */

function createMockClient() {
  return {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  } as any;
}

describe('Value Estimation - OpenAIAnalyzer (PRD 0006)', () => {
  const mockImageBuffer = Buffer.from('fake-image-data');
  let cheapClient: ReturnType<typeof createMockClient>;
  let premiumClient: ReturnType<typeof createMockClient>;
  let analyzer: OpenAIAnalyzer;

  beforeEach(() => {
    cheapClient = createMockClient();
    premiumClient = createMockClient();
    analyzer = new OpenAIAnalyzer(cheapClient, premiumClient);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('analyze() with cheap model', () => {
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

      cheapClient.chat.completions.create.mockResolvedValue(mockResponse);

      const result = await analyzer.analyze(mockImageBuffer);

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

      cheapClient.chat.completions.create.mockResolvedValue(mockResponse);

      const result = await analyzer.analyze(mockImageBuffer);

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

      cheapClient.chat.completions.create.mockResolvedValue(mockResponse);

      const result = await analyzer.analyze(mockImageBuffer);

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

      cheapClient.chat.completions.create.mockResolvedValue(mockResponse);

      const result = await analyzer.analyze(mockImageBuffer);

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

      cheapClient.chat.completions.create.mockResolvedValue(mockResponse);

      const result = await analyzer.analyze(mockImageBuffer);

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

      cheapClient.chat.completions.create.mockResolvedValue(mockResponse);

      await expect(analyzer.analyze(mockImageBuffer)).rejects.toThrow('No response from AI');
    });
  });

  describe('analyze() with premium fallback', () => {
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

      cheapClient.chat.completions.create.mockResolvedValue(cheapResponse);

      const result = await analyzer.analyze(mockImageBuffer);

      expect(result.name).toBe('Phone');
      expect(result.estimatedValue).toBe('200.00');
      // Premium model should not have been called
      expect(premiumClient.chat.completions.create).not.toHaveBeenCalled();
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

      cheapClient.chat.completions.create.mockResolvedValue(cheapResponse);
      premiumClient.chat.completions.create.mockResolvedValue(premiumResponse);

      const result = await analyzer.analyze(mockImageBuffer);

      // Should return premium result
      expect(result.name).toBe('Rare Collectible');
      expect(result.estimatedValue).toBe('450.00');
      expect(result.confidence).toBe(0.9);
      // Both models should have been called
      expect(cheapClient.chat.completions.create).toHaveBeenCalled();
      expect(premiumClient.chat.completions.create).toHaveBeenCalled();
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

      cheapClient.chat.completions.create.mockResolvedValue(cheapResponse);

      const result = await analyzer.analyze(mockImageBuffer);

      expect(result.confidence).toBe(0.4);
      expect(result.estimatedValue).toBe('25.00');
      // Premium should not be called at exactly 0.4
      expect(premiumClient.chat.completions.create).not.toHaveBeenCalled();
    });

    it('should default to 0.9 confidence for premium model if not provided', async () => {
      // Force fallback to premium by returning low confidence from cheap
      cheapClient.chat.completions.create.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              name: 'Unknown',
              confidence: 0.1,
            }),
          },
        }],
      });

      premiumClient.chat.completions.create.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              name: 'Item',
              description: 'Test',
              category: 'Other',
              // No confidence provided — should default to 0.9 for premium
            }),
          },
        }],
      });

      const result = await analyzer.analyze(mockImageBuffer);

      expect(result.confidence).toBe(0.9);
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

        cheapClient.chat.completions.create.mockResolvedValue(mockResponse);

        const result = await analyzer.analyze(mockImageBuffer);
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

        cheapClient.chat.completions.create.mockResolvedValue(mockResponse);

        const result = await analyzer.analyze(mockImageBuffer);
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

        cheapClient.chat.completions.create.mockResolvedValue(mockResponse);

        const result = await analyzer.analyze(mockImageBuffer);
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

        cheapClient.chat.completions.create.mockResolvedValue(mockResponse);

        const result = await analyzer.analyze(mockImageBuffer);
        expect(result.valueConfidence).toBeNull();
      }
    });
  });
});
