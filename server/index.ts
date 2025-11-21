import 'dotenv/config';

// Diagnostic: Show API key prefix at startup (BEFORE any services are loaded)
console.log("Loaded API key prefix:", process.env.OPENAI_API_KEY?.slice(0, 10) || "NOT SET");

// Process-level crash traps for debugging
process.on("uncaughtException", e => console.error("uncaughtException:", e));
process.on("unhandledRejection", e => console.error("unhandledRejection:", e));
process.on("exit", code => console.error("exit code:", code));

import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { loadAppConfig, createProdServices } from "./services";
import { setupVite, serveStatic, log } from "./vite";
import { ApiError } from "./errors";
import { promises as fs } from "fs";
import path from "path";

const app = express();

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  try {
    console.log("A: entering main");

    // Load and validate application configuration (PRD 0005)
    const config = loadAppConfig();
    log(`🔧 Storage backend: Local filesystem (${config.localStorageDir})`);

    // Ensure local storage directory exists
    try {
      await fs.mkdir(config.localStorageDir, { recursive: true });
      await fs.access(config.localStorageDir);
      log(`✓ Local storage directory ready: ${config.localStorageDir}`);
    } catch (error) {
      log(`⚠️  Warning: Unable to access local storage directory: ${error}`);
    }

    // Initialize service container (PRD 0005)
    const services = await createProdServices(config);
    console.log("B: after createProdServices");

  // Register routes with injected services (PRD 0005)
  const server = await registerRoutes(app, services);

  // Error handling middleware
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

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  const env = app.get("env");
  if (env === "development") {
    await setupVite(app, server);
  } else if (env === "api-only") {
    // API-only mode for E2E testing: skip Vite middleware and static serving
    // Frontend will be served by separate Vite dev server with proxy
    log("Running in API-only mode (no UI serving)");
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  console.log("C: before app.listen");
  server.on("error", (err) => console.error("listen error:", err));
  server.listen(port, "0.0.0.0", () => {
    console.log("D: inside listen callback");
    log(`serving on port ${port}`);
  });
  } catch (err) {
    console.error("main() caught error:", err);
    process.exit(1);
  }
})();
