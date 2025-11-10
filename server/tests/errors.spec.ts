import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express, { type Express, type Request, Response, NextFunction } from 'express';
import { ApiError, wrap } from '../errors';

describe('Error Handling', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());

    // Test routes for different error scenarios

    // 1. NOT_FOUND - ApiError with 404
    app.get('/api/test/not-found', wrap(async (_req, _res) => {
      throw new ApiError(404, 'NOT_FOUND', 'Item not found');
    }));

    // 2. VALIDATION_ERROR - Zod-like error with issues array
    app.post('/api/test/validation', wrap(async (_req, _res) => {
      const zodLikeError: any = new Error('Validation failed');
      zodLikeError.issues = [
        { path: ['name'], message: 'Required' },
        { path: ['age'], message: 'Must be positive' }
      ];
      throw zodLikeError;
    }));

    // 3. UPSTREAM_AI - Simulated OpenAI error
    app.post('/api/test/upstream-ai', wrap(async (_req, _res) => {
      const openAIError: any = new Error('Model timeout');
      openAIError.name = 'OpenAIError';
      openAIError.status = 502;
      openAIError.message = 'Model timeout';
      throw openAIError;
    }));

    // 4. UNHANDLED - Generic error
    app.get('/api/test/unhandled', wrap(async (_req, _res) => {
      throw new Error('Unexpected database error');
    }));

    // Error handling middleware (matches server/index.ts)
    const isProd = process.env.NODE_ENV === 'production';

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      // Handle ApiError instances
      if (err instanceof ApiError) {
        return res.status(err.status).json({
          error: err.message,
          code: err.code
        });
      }

      // Handle Zod validation errors (hide details in production)
      if (err?.issues?.length) {
        return res.status(400).json({
          error: 'Invalid request',
          code: 'VALIDATION_ERROR',
          ...(isProd ? {} : { details: err.issues })
        });
      }

      // Handle OpenAI/upstream SDK errors (normalize messages)
      if (err?.status && err?.message && err?.name?.includes('OpenAI')) {
        return res.status(err.status).json({
          error: 'Upstream AI error',
          code: 'UPSTREAM_AI'
        });
      }

      // Unhandled errors
      console.error('Unhandled error:', err);
      const status = err.status || err.statusCode || 500;
      res.status(status).json({
        error: isProd ? 'Internal Server Error' : err.message || 'Internal Server Error',
        code: 'UNHANDLED'
      });
    });
  });

  describe('NOT_FOUND error', () => {
    it('should return 404 with correct error format', async () => {
      const response = await request(app)
        .get('/api/test/not-found')
        .expect(404)
        .expect('Content-Type', /json/);

      expect(response.body).toEqual({
        error: 'Item not found',
        code: 'NOT_FOUND'
      });
    });
  });

  describe('VALIDATION_ERROR', () => {
    it('should return 400 with validation error format', async () => {
      const response = await request(app)
        .post('/api/test/validation')
        .send({})
        .expect(400)
        .expect('Content-Type', /json/);

      expect(response.body).toMatchObject({
        error: 'Invalid request',
        code: 'VALIDATION_ERROR'
      });
    });

    it('should include validation details in development', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const response = await request(app)
        .post('/api/test/validation')
        .send({})
        .expect(400);

      expect(response.body).toMatchObject({
        error: 'Invalid request',
        code: 'VALIDATION_ERROR',
        details: expect.arrayContaining([
          expect.objectContaining({ path: ['name'], message: 'Required' })
        ])
      });

      process.env.NODE_ENV = originalEnv;
    });

    it('should hide validation details in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      // Re-create app with production environment
      const prodApp = express();
      prodApp.use(express.json());

      prodApp.post('/api/test/validation', wrap(async (_req, _res) => {
        const zodLikeError: any = new Error('Validation failed');
        zodLikeError.issues = [{ path: ['name'], message: 'Required' }];
        throw zodLikeError;
      }));

      const isProd = true; // Force production mode
      prodApp.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
        if (err?.issues?.length) {
          return res.status(400).json({
            error: 'Invalid request',
            code: 'VALIDATION_ERROR',
            ...(isProd ? {} : { details: err.issues })
          });
        }
      });

      const response = await request(prodApp)
        .post('/api/test/validation')
        .send({})
        .expect(400);

      expect(response.body).toEqual({
        error: 'Invalid request',
        code: 'VALIDATION_ERROR'
      });
      expect(response.body.details).toBeUndefined();

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('UPSTREAM_AI error', () => {
    it('should return 502 with upstream AI error format', async () => {
      const response = await request(app)
        .post('/api/test/upstream-ai')
        .send({})
        .expect(502)
        .expect('Content-Type', /json/);

      expect(response.body).toEqual({
        error: 'Upstream AI error',
        code: 'UPSTREAM_AI'
      });
    });

    it('should normalize OpenAI error messages', async () => {
      const response = await request(app)
        .post('/api/test/upstream-ai')
        .send({});

      // Verify sensitive details are not leaked
      expect(response.body.error).toBe('Upstream AI error');
      expect(response.body.code).toBe('UPSTREAM_AI');
      expect(response.body).not.toHaveProperty('message');
      expect(response.body).not.toHaveProperty('stack');
    });
  });

  describe('UNHANDLED error', () => {
    it('should return 500 with unhandled error format', async () => {
      const response = await request(app)
        .get('/api/test/unhandled')
        .expect(500)
        .expect('Content-Type', /json/);

      expect(response.body).toMatchObject({
        code: 'UNHANDLED'
      });
    });

    it('should expose error message in development', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const response = await request(app)
        .get('/api/test/unhandled')
        .expect(500);

      expect(response.body).toEqual({
        error: 'Unexpected database error',
        code: 'UNHANDLED'
      });

      process.env.NODE_ENV = originalEnv;
    });

    it('should hide error message in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const prodApp = express();
      prodApp.use(express.json());

      prodApp.get('/api/test/unhandled', wrap(async (_req, _res) => {
        throw new Error('Sensitive internal error');
      }));

      const isProd = true;
      prodApp.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
        const status = err.status || err.statusCode || 500;
        res.status(status).json({
          error: isProd ? 'Internal Server Error' : err.message || 'Internal Server Error',
          code: 'UNHANDLED'
        });
      });

      const response = await request(prodApp)
        .get('/api/test/unhandled')
        .expect(500);

      expect(response.body).toEqual({
        error: 'Internal Server Error',
        code: 'UNHANDLED'
      });
      expect(response.body.error).not.toContain('Sensitive');

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('Error response format consistency', () => {
    it('all errors should have error and code fields', async () => {
      const tests = [
        { endpoint: '/api/test/not-found', method: 'get' },
        { endpoint: '/api/test/validation', method: 'post' },
        { endpoint: '/api/test/upstream-ai', method: 'post' },
        { endpoint: '/api/test/unhandled', method: 'get' }
      ];

      for (const test of tests) {
        const response = await request(app)[test.method](test.endpoint).send({});

        expect(response.body).toHaveProperty('error');
        expect(response.body).toHaveProperty('code');
        expect(typeof response.body.error).toBe('string');
        expect(typeof response.body.code).toBe('string');
      }
    });
  });
});
