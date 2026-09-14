/**
 * Gemini ThoughtVault Server Entry Point
 * 
 * Production Security Rules:
 * 1. Binds exclusively to PORT 3000 and HOST 0.0.0.0.
 * 2. Express JSON parser limited to 64kb to prevent memory exhaustion.
 * 3. Enforces standard HTTP security response headers.
 * 4. API routes mounted before Vite middleware.
 * 5. Fail-closed global error handler ensures zero secret/trace leaks.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'path';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import journalRouter from './server/routes/journal';
import evolutionRouter from './server/routes/evolution';
import askRouter from './server/routes/ask';
import insightsRouter from './server/routes/insights';
import { validateServerConfig, redactSecrets } from './server/lib/config';
import { logger, metrics } from './server/lib/logger';

async function startServer() {
  // Validate required runtime secrets on boot (Fail-safe verification)
  validateServerConfig();

  const app = express();
  // Runtime-safe port configuration:
  // In the AI Studio container, the internal nginx reverse proxy exclusively targets port 3000 (detected via APPLET_ID).
  // In standalone Cloud Run production, Cloud Run dynamically provisions PORT (default 8080 or custom --port value).
  const PORT = process.env.APPLET_ID ? 3000 : (Number(process.env.PORT) || 3000);

  // Request correlation & privacy-preserving telemetry middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    const rawReqId = req.headers['x-request-id'];
    const validHeaderId = typeof rawReqId === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(rawReqId)
      ? rawReqId
      : null;
    const requestId = validHeaderId || crypto.randomUUID();

    // Attach to request and set standard response header
    (req as Request & { id: string }).id = requestId;
    res.setHeader('X-Request-ID', requestId);

    const start = Date.now();
    res.on('finish', () => {
      const durationMs = Date.now() - start;
      // Record privacy-safe operational metric
      metrics.recordRequest(req.path, res.statusCode, durationMs);

      // Only log API and health requests to prevent log spamming
      if (req.path.startsWith('/api') || req.path === '/health') {
        logger.info(`HTTP Request completed`, {
          requestId,
          method: req.method,
          route: req.path,
          statusCode: res.statusCode,
          durationMs,
        });
      }
    });

    next();
  });

  // Security response headers
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    // HSTS enforced strictly in production HTTPS environments
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    // Content Security Policy (CSP) tailored for Gemini ThoughtVault & Firebase Auth
    const cspDirectives = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://apis.google.com https://*.firebaseapp.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: https://*.googleusercontent.com",
      "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://*.googleapis.com https://*.firebaseio.com",
      "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com",
      "frame-ancestors 'self' https://ai.studio https://*.google.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ];
    res.setHeader('Content-Security-Policy', cspDirectives.join('; '));

    next();
  });

  // Body parsing limited to 64kb
  app.use(express.json({ limit: '64kb' }));

  // Catch body-parser limits (413) and JSON syntax errors (400) gracefully
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    const errorObj = err as { status?: number; type?: string };
    if (errorObj?.status === 413 || errorObj?.type === 'entity.too.large') {
      res.status(413).json({
        error: 'Payload exceeds maximum allowed limit of 64kb.',
        code: 'PAYLOAD_TOO_LARGE'
      });
      return;
    }
    if (err instanceof SyntaxError && errorObj?.status === 400) {
      res.status(400).json({
        error: 'Malformed JSON payload.',
        code: 'INVALID_JSON_BODY'
      });
      return;
    }
    next(err);
  });

  // Ensure private user-owned data from API endpoints is never cached by shared proxies, CDNs, or browsers
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    next();
  });

  // Unified health endpoint handler (fast, unauthenticated, zero external calls)
  const healthHandler = (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.json({
      status: 'ok',
      service: 'gemini-thoughtvault',
      timestamp: new Date().toISOString(),
    });
  };

  app.get('/health', healthHandler);
  app.get('/api/health', healthHandler);

  // Authenticated Journal AI Routes
  app.use('/api/journal/evolution', evolutionRouter);
  app.use('/api/journal/ask', askRouter);
  app.use('/api/journal/insights', insightsRouter);
  app.use('/api/journal', journalRouter);

  // Catch unmatched API routes with 404
  app.all('/api/*', (req: Request, res: Response) => {
    res.status(404).json({
      error: `API route ${req.method} ${req.path} not found.`,
      code: 'ROUTE_NOT_FOUND'
    });
  });

  // Explicitly block public access to backend compiled bundle, source maps, and sensitive project files
  app.all([
    '/server.cjs',
    '/server.cjs.map',
    '/.env*',
    '/tsconfig.json',
    '/package.json',
    '/package-lock.json',
    '/firestore.rules'
  ], (req: Request, res: Response) => {
    res.status(404).json({
      error: 'Not found.',
      code: 'ROUTE_NOT_FOUND',
    });
  });

  // Vite Middleware integration for dev / static serving in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');

    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Global uncaught error handler
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const errorMsg = err instanceof Error ? err.message : 'Internal Server Error';
    console.error(`[UNCAUGHT ERROR] Path: ${req.path} | Error: ${redactSecrets(errorMsg)}`);
    res.status(500).json({
      error: 'An unexpected internal error occurred. Please try again.',
      code: 'INTERNAL_SERVER_ERROR'
    });
  });

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[THOUGHTVAULT SERVER] Running on http://localhost:${PORT}`);
  });

  // Graceful shutdown handling for Cloud Run container lifecycle
  let isShuttingDown = false;
  const SHUTDOWN_TIMEOUT_MS = 10000; // 10-second bounded grace period

  function gracefulShutdown(signal: string) {
    if (isShuttingDown) {
      console.warn(`[SHUTDOWN] Duplicate ${signal} signal received during active shutdown. Ignoring.`);
      return;
    }
    isShuttingDown = true;
    console.info(`[SHUTDOWN] Received ${signal}. Stopping new connections and allowing active requests to finish (max ${SHUTDOWN_TIMEOUT_MS / 1000}s)...`);

    // Stop accepting new HTTP connections
    server.close((err?: Error) => {
      if (err) {
        console.error(`[SHUTDOWN ERROR] Error while closing HTTP server: ${redactSecrets(err.message)}`);
        process.exit(1);
      }
      console.info('[SHUTDOWN] All active connections drained cleanly. Server stopped.');
      process.exit(0);
    });

    // Forced exit boundary if active requests do not drain within grace period
    const forceTimer = setTimeout(() => {
      console.warn(`[SHUTDOWN TIMEOUT] Forced exit after ${SHUTDOWN_TIMEOUT_MS / 1000}s timeout boundary.`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    // Unref timer so it does not keep event loop alive if server drains early
    if (forceTimer.unref) {
      forceTimer.unref();
    }
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  return { app, server, gracefulShutdown };
}

startServer();
