/**
 * Privacy-Preserving Structured Logger & Operational Telemetry (Milestone 11.5)
 * 
 * Production Security & Observability Rules:
 * 1. Zero Sensitive Content: Never logs journal text, reflection prompts, queries, citations,
 *    auth tokens, API keys, or raw Gemini outputs.
 * 2. UID Masking: UIDs are consistently masked to their first 6-8 characters (e.g. usr_1234...).
 * 3. Consistent Error Taxonomy: Categorizes failures into standard operational categories:
 *    AUTH, VALIDATION, RATE_LIMIT, NOT_FOUND, FIRESTORE, GEMINI, CACHE, TIMEOUT, INTERNAL.
 * 4. Request Correlation: Correlates operations with safe, random requestId.
 * 5. Privacy-Preserving Metrics: In-memory counters for routes, statuses, fallbacks, and error categories
 *    with zero user-identifying labels.
 */

import { redactSecrets } from './config';

export type ErrorCategory =
  | 'AUTH'
  | 'VALIDATION'
  | 'RATE_LIMIT'
  | 'NOT_FOUND'
  | 'FIRESTORE'
  | 'GEMINI'
  | 'CACHE'
  | 'TIMEOUT'
  | 'INTERNAL';

export interface LogMetadata {
  requestId?: string;
  method?: string;
  route?: string;
  statusCode?: number;
  durationMs?: number;
  errorCategory?: ErrorCategory;
  errorCode?: string;
  modelUsed?: string;
  fallbackTier?: number;
  cacheStatus?: 'HIT' | 'MISS' | 'STALE' | 'ERROR';
  retrievalCount?: number;
  userIdPrefix?: string;
  [key: string]: unknown;
}

/**
 * Masks a user UID to a safe non-reversible prefix (e.g. "usr_abc1...").
 */
export function maskUserId(uid?: string): string {
  if (!uid || typeof uid !== 'string') return 'anonymous';
  const clean = uid.trim();
  if (clean.length <= 6) return 'usr_***';
  return `${clean.slice(0, 6)}...`;
}

/**
 * Sanitizes arbitrary log strings to remove secrets, tokens, or sensitive patterns.
 */
export function sanitizeLogString(str: string): string {
  if (!str) return '';
  let cleaned = redactSecrets(str);

  // Redact potential emails
  cleaned = cleaned.replace(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g, '[REDACTED_EMAIL]');

  // Redact potential JWT or ID token fragments
  cleaned = cleaned.replace(/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, '[REDACTED_TOKEN]');

  // Redact potential API keys (AIza...)
  cleaned = cleaned.replace(/AIza[0-9A-Za-z-_]{35}/g, '[REDACTED_API_KEY]');

  return cleaned;
}

// In-Memory Privacy-Preserving Operational Metrics Collector
class PrivacyMetricsCollector {
  private totalRequests = 0;
  private statusCodes = new Map<number, number>();
  private routeCounts = new Map<string, number>();
  private errorCategories = new Map<ErrorCategory, number>();
  private cacheEvents = { hit: 0, miss: 0, stale: 0, error: 0 };
  private fallbackEvents = new Map<string, number>();
  private rateLimitRejections = 0;

  public recordRequest(route: string, statusCode: number, durationMs: number): void {
    this.totalRequests++;
    this.statusCodes.set(statusCode, (this.statusCodes.get(statusCode) || 0) + 1);
    this.routeCounts.set(route, (this.routeCounts.get(route) || 0) + 1);
  }

  public recordError(category: ErrorCategory): void {
    this.errorCategories.set(category, (this.errorCategories.get(category) || 0) + 1);
  }

  public recordCacheEvent(event: 'hit' | 'miss' | 'stale' | 'error'): void {
    if (event in this.cacheEvents) {
      this.cacheEvents[event]++;
    }
  }

  public recordFallback(model: string, tier: number): void {
    const key = `${model}_tier${tier}`;
    this.fallbackEvents.set(key, (this.fallbackEvents.get(key) || 0) + 1);
  }

  public recordRateLimitRejection(): void {
    this.rateLimitRejections++;
  }

  public getSummary() {
    return {
      totalRequests: this.totalRequests,
      statusCodes: Object.fromEntries(this.statusCodes),
      routeCounts: Object.fromEntries(this.routeCounts),
      errorCategories: Object.fromEntries(this.errorCategories),
      cacheEvents: { ...this.cacheEvents },
      fallbackEvents: Object.fromEntries(this.fallbackEvents),
      rateLimitRejections: this.rateLimitRejections,
    };
  }

  public reset(): void {
    this.totalRequests = 0;
    this.statusCodes.clear();
    this.routeCounts.clear();
    this.errorCategories.clear();
    this.cacheEvents = { hit: 0, miss: 0, stale: 0, error: 0 };
    this.fallbackEvents.clear();
    this.rateLimitRejections = 0;
  }
}

export const metrics = new PrivacyMetricsCollector();

/**
 * Structured Logger with strict privacy and redaction guarantees.
 */
export const logger = {
  info(message: string, meta?: LogMetadata): void {
    const sanitizedMsg = sanitizeLogString(message);
    const metaStr = meta ? ` | ${formatMeta(meta)}` : '';
    console.info(`[INFO] ${sanitizedMsg}${metaStr}`);
  },

  warn(message: string, meta?: LogMetadata): void {
    const sanitizedMsg = sanitizeLogString(message);
    const metaStr = meta ? ` | ${formatMeta(meta)}` : '';
    console.warn(`[WARN] ${sanitizedMsg}${metaStr}`);
  },

  error(message: string, meta?: LogMetadata): void {
    const sanitizedMsg = sanitizeLogString(message);
    if (meta?.errorCategory) {
      metrics.recordError(meta.errorCategory);
    }
    const metaStr = meta ? ` | ${formatMeta(meta)}` : '';
    console.error(`[ERROR] ${sanitizedMsg}${metaStr}`);
  },
};

function formatMeta(meta: LogMetadata): string {
  const parts: string[] = [];
  if (meta.requestId) parts.push(`req=${meta.requestId}`);
  if (meta.method && meta.route) parts.push(`${meta.method} ${meta.route}`);
  if (meta.statusCode) parts.push(`status=${meta.statusCode}`);
  if (meta.durationMs !== undefined) parts.push(`${meta.durationMs}ms`);
  if (meta.userIdPrefix) parts.push(`user=${meta.userIdPrefix}`);
  if (meta.errorCategory) parts.push(`cat=${meta.errorCategory}`);
  if (meta.errorCode) parts.push(`code=${meta.errorCode}`);
  if (meta.modelUsed) parts.push(`model=${meta.modelUsed}`);
  if (meta.fallbackTier) parts.push(`tier=${meta.fallbackTier}`);
  if (meta.cacheStatus) parts.push(`cache=${meta.cacheStatus}`);
  if (meta.retrievalCount !== undefined) parts.push(`candidates=${meta.retrievalCount}`);
  return parts.join(' ');
}
