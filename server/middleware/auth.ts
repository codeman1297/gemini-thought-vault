/**
 * Firebase Admin Authentication Middleware
 * 
 * Production Security Rules:
 * 1. Verifies cryptographic signature, issuer, audience, and expiry of the Firebase ID token.
 * 2. Derives trusted identity strictly from decodedToken.uid.
 * 3. Never accepts client-supplied userId or uid from body, query, or custom headers.
 * 4. Fails closed with 401 Unauthorized on any token validation issue.
 * 5. Does not leak stack traces or internal errors to client.
 */

import type { Response, NextFunction } from 'express';
import { initializeApp, getApps, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { AuthenticatedRequest } from '../types';

let adminApp: App | null = null;

function getAdminApp(): App {
  if (adminApp) return adminApp;

  if (getApps().length > 0) {
    adminApp = getApps()[0];
    return adminApp;
  }

  const projectId = 
    process.env.FIREBASE_PROJECT_ID || 
    process.env.VITE_FIREBASE_PROJECT_ID || 
    process.env.GOOGLE_CLOUD_PROJECT;

  adminApp = initializeApp(projectId ? { projectId } : {});
  return adminApp;
}

export async function verifyFirebaseToken(
  req: AuthenticatedRequest, 
  res: Response, 
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({
      error: 'Unauthorized: Missing Authorization header.',
      code: 'AUTH_MISSING_HEADER'
    });
    return;
  }

  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Unauthorized: Authorization scheme must be Bearer.',
      code: 'AUTH_INVALID_SCHEME'
    });
    return;
  }

  const idToken = authHeader.split('Bearer ')[1]?.trim();
  if (!idToken) {
    res.status(401).json({
      error: 'Unauthorized: Token payload is empty.',
      code: 'AUTH_EMPTY_TOKEN'
    });
    return;
  }

  try {
    const app = getAdminApp();
    const auth = getAuth(app);
    const decodedToken = await auth.verifyIdToken(idToken);

    if (!decodedToken || !decodedToken.uid) {
      res.status(401).json({
        error: 'Unauthorized: Token does not contain a valid user identity.',
        code: 'AUTH_INVALID_CLAIMS'
      });
      return;
    }

    // Bind trusted user identity
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email || null,
    };

    next();
  } catch (err: unknown) {
    const authError = err as { code?: string; message?: string };
    
    // Controlled, privacy-safe logging without leaking token
    console.warn(`[AUTH] Token verification failed: ${authError.code || 'UNKNOWN_ERROR'}`);

    if (authError.code === 'auth/id-token-expired') {
      res.status(401).json({
        error: 'Unauthorized: Authentication token has expired. Please refresh your session.',
        code: 'AUTH_TOKEN_EXPIRED'
      });
      return;
    }

    if (authError.code === 'auth/id-token-revoked') {
      res.status(401).json({
        error: 'Unauthorized: Session has been revoked. Please sign in again.',
        code: 'AUTH_TOKEN_REVOKED'
      });
      return;
    }

    res.status(401).json({
      error: 'Unauthorized: Invalid authentication credentials.',
      code: 'AUTH_INVALID_CREDENTIALS'
    });
  }
}
