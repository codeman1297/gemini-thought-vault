/**
 * Server-Side Cloud Firestore Client Module
 * 
 * Production Security Rules:
 * 1. Uses Firebase Admin SDK to access Firestore securely on the backend.
 * 2. Strips all undefined fields before sending mutations to Firestore.
 * 3. Enforces strict path construction rooted exclusively in /users/${trustedUid}.
 * 4. Never exposes database admin credentials to the client.
 */

import { initializeApp, getApps, type App } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';

let adminApp: App | null = null;
let dbInstance: Firestore | null = null;

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

export function getDb(): Firestore {
  if (dbInstance) return dbInstance;
  const app = getAdminApp();
  const databaseId = process.env.FIRESTORE_DATABASE_ID || '(default)';
  dbInstance = getFirestore(app, databaseId);
  // Configure Firestore settings if needed
  try {
    dbInstance.settings({ ignoreUndefinedProperties: true });
  } catch {
    // Settings may already be locked if initialized elsewhere
  }
  return dbInstance;
}

/**
 * Strips all undefined values deeply from an object before Firestore writes.
 * Ensures zero undefined-field runtime errors in Firestore.
 */
export function stripUndefined<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj
      .filter((item) => item !== undefined)
      .map((item) => stripUndefined(item)) as unknown as T;
  }

  if (typeof obj === 'object' && !(obj instanceof Date) && !(obj instanceof Timestamp)) {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }
      if (value !== undefined) {
        cleaned[key] = stripUndefined(value);
      }
    }
    return cleaned as T;
  }

  return obj;
}

/**
 * Validates that a user ID conforms to secure Firestore path requirements.
 * Rejects empty, whitespace-only, traversal-prone, or excessively long UIDs.
 */
export function assertValidUid(uid: unknown): asserts uid is string {
  if (!uid || typeof uid !== 'string' || uid.trim().length === 0) {
    throw new Error('Unauthorized: Missing authenticated UID context.');
  }
  if (uid.includes('/') || uid.includes('..') || uid.trim() !== uid || uid.length > 128) {
    throw new Error('Unauthorized: Invalid UID format.');
  }
}

/**
 * Validates that a document/entity identifier is safe for Firestore path composition.
 * Rejects traversal sequences, slashes, or abnormal length strings.
 */
export function assertValidId(id: unknown, label = 'Identifier'): asserts id is string {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new Error(`Invalid ${label}: must be a non-empty string.`);
  }
  if (id.includes('/') || id.includes('..') || id.trim() !== id || id.length > 128) {
    throw new Error(`Invalid ${label}: contains illegal characters or path traversal.`);
  }
}

export { FieldValue, Timestamp };
