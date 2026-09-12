/**
 * Server Configuration & Secret Hardening Module
 * Milestone 6: Google Cloud Secret Manager Runtime Secret Injection
 * 
 * Production Security Rules:
 * 1. ZERO secret values or lengths printed to logs or responses.
 * 2. In production Cloud Run, GEMINI_API_KEY is injected directly from
 *    Google Cloud Secret Manager (secret: gemini-thoughtvault-api-key).
 * 3. Local development can supply GEMINI_API_KEY via untracked .env file.
 * 4. Automatic secret scrubbing via redactSecrets() ensures API keys and Bearer
 *    tokens are never leaked into console or error messages.
 * 5. Fail-closed: missing credentials halt operations gracefully without exposing internals.
 */

export const SECRET_MANAGER_SECRET_NAME = 'gemini-thoughtvault-api-key';

/**
 * Redacts known sensitive patterns (Google API keys, Bearer tokens, private keys)
 * from any string before it is output to console or error payloads.
 */
export function redactSecrets(input: string): string {
  if (!input || typeof input !== 'string') return '';

  let sanitized = input;

  // 1. Redact Google API key format (e.g., AIzaSy...)
  sanitized = sanitized.replace(/AIza[0-9A-Za-z-_]{35}/g, '[REDACTED_API_KEY]');

  // 2. Redact Bearer tokens
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/gi, 'Bearer [REDACTED_TOKEN]');

  // 3. Redact the active GEMINI_API_KEY if present in the string
  const currentKey = process.env.GEMINI_API_KEY?.trim();
  if (currentKey && currentKey.length > 5) {
    sanitized = sanitized.split(currentKey).join('[REDACTED_GEMINI_KEY]');
  }

  return sanitized;
}

/**
 * Returns the securely injected Gemini API key from the server runtime environment.
 * In Cloud Run, this is populated via Secret Manager runtime secret injection:
 *   --set-secrets="GEMINI_API_KEY=gemini-thoughtvault-api-key:latest"
 * 
 * In local development, it is loaded from local .env.
 * Throws a controlled, non-disclosing error if missing.
 */
export function getConfiguredGeminiApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  
  if (!apiKey) {
    throw new Error(
      `Server secret missing: GEMINI_API_KEY is not defined. In Cloud Run, ensure the secret '${SECRET_MANAGER_SECRET_NAME}' is bound to GEMINI_API_KEY.`
    );
  }

  return apiKey;
}

export interface ServerConfigValidation {
  valid: boolean;
  warnings: string[];
}

/**
 * Performs fail-closed sanity verification of required server secrets on boot.
 * NEVER prints secret values or character lengths.
 */
export function validateServerConfig(): ServerConfigValidation {
  const warnings: string[] = [];
  const isProduction = process.env.NODE_ENV === 'production';
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    const errorMsg = isProduction
      ? `[FATAL CONFIG] GEMINI_API_KEY is missing in production runtime. Ensure Cloud Run secret injection is configured for '${SECRET_MANAGER_SECRET_NAME}'.`
      : `[DEV CONFIG WARNING] GEMINI_API_KEY is missing in local environment. Add GEMINI_API_KEY to your local .env file.`;
    
    console.warn(errorMsg);
    warnings.push('GEMINI_API_KEY missing');
    return { valid: false, warnings };
  }

  console.info('[CONFIG] Server runtime secrets verified. Gemini API key is securely present (Secret Manager / Runtime Injection).');
  return { valid: true, warnings };
}
