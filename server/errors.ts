import type { Request, Response, NextFunction } from 'express';

/**
 * Custom API error class with status code and error code
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Async route wrapper - catches unhandled promise rejections
 *
 * IMPORTANT: ALL async route handlers MUST use this wrapper
 * to ensure errors are properly caught by the error middleware.
 *
 * @example
 * app.get('/api/items', wrap(async (req, res) => {
 *   const items = await storage.getItems();
 *   res.json(items);
 * }));
 *
 * @example
 * app.get('/api/items/:id', wrap(async (req, res) => {
 *   const item = await storage.getItem(req.params.id);
 *   if (!item) throw new ApiError(404, 'NOT_FOUND', 'Item not found');
 *   res.json(item);
 * }));
 */
export const wrap = (handler: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(handler(req, res, next)).catch(next);
