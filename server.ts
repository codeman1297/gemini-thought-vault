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
import { createServer as createViteServer } from 'vite';
import journalRouter from './server/routes/journal';
import { validateServerConfig, redactSecrets } from './server/lib/config';

async function startServer() {
  // Validate required runtime secrets on boot (Fail-safe verification)
  validateServerConfig();

  const app = express();
  const PORT = 3000;

  // Security response headers
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Body parsing limited to 64kb
  app.use(express.json({ limit: '64kb' }));

  // Catch body-parser JSON syntax errors gracefully
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && 'status' in err && err.status === 400) {
      res.status(400).json({
        error: 'Malformed JSON payload.',
        code: 'INVALID_JSON_BODY'
      });
      return;
    }
    next(err);
  });

  // Health endpoint
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'gemini-thoughtvault',
      timestamp: new Date().toISOString(),
    });
  });

  // Authenticated Journal AI Routes
  app.use('/api/journal', journalRouter);

  // Catch unmatched API routes with 404
  app.all('/api/*', (req: Request, res: Response) => {
    res.status(404).json({
      error: `API route ${req.method} ${req.path} not found.`,
      code: 'ROUTE_NOT_FOUND'
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[THOUGHTVAULT SERVER] Running on http://localhost:${PORT}`);
  });
}

startServer();
