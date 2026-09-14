/**
 * Gemini Service with Constitution-Mandated 4-Tier Model Fallback Ladder
 * 
 * Production Security Rules:
 * 1. API key is loaded strictly from process.env.GEMINI_API_KEY (never exposed to client).
 * 2. Uses required fallback ladder: gemini-3.6-flash -> gemini-3.1-flash-lite -> gemini-flash-latest -> gemini-3.7-flash.
 * 3. Recovers from 429, 503, 404, 500 errors sequentially.
 * 4. Delimits user prompt (<user_reflection>) to defend against prompt injection.
 * 5. Logs only non-sensitive metadata (latencies, model used); never logs raw journal text.
 */

import { GoogleGenAI } from '@google/genai';
import { getConfiguredGeminiApiKey, redactSecrets } from '../lib/config';
import type { ConversationTurn, JournalReflectionInsights } from '../types';
import { REFLECTION_SYSTEM_INSTRUCTION, validateAndSanitizeReflection } from './reflectionEngine';

// The 4-tier model fallback ladder required by the Security Constitution
export const MODEL_FALLBACK_LADDER = [
  'gemini-3.6-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
  'gemini-3.7-flash',
] as const;

let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  if (aiClient) return aiClient;

  const apiKey = getConfiguredGeminiApiKey();
  aiClient = new GoogleGenAI({ apiKey });
  return aiClient;
}

const SYSTEM_INSTRUCTION = REFLECTION_SYSTEM_INSTRUCTION;

interface FallbackResult {
  text: string;
  insights: JournalReflectionInsights;
  modelUsed: string;
  fallbackUsed: boolean;
  attemptsCount: number;
  latencyMs: number;
}

export const GEMINI_ATTEMPT_TIMEOUT_MS = 25000; // 25s bounded attempt

/**
 * Executes an asynchronous operation bounded by a timeout.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${operationName} timed out after ${timeoutMs}ms`);
      (err as unknown as { status: number }).status = 504;
      reject(err);
    }, timeoutMs);
    if (timer.unref) {
      timer.unref();
    }
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function isRecoverableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const errString = String(error).toLowerCase();
  const errMsg = 'message' in error && typeof error.message === 'string' 
    ? error.message.toLowerCase() 
    : '';
  const status = 'status' in error ? Number((error as { status?: unknown }).status) : 0;

  // Recoverable error codes: 429, 503, 404, 500, 504 (timeout)
  if ([429, 503, 404, 500, 504].includes(status)) {
    return true;
  }

  return (
    errString.includes('429') ||
    errString.includes('503') ||
    errString.includes('404') ||
    errString.includes('500') ||
    errString.includes('504') ||
    errString.includes('resource_exhausted') ||
    errString.includes('unavailable') ||
    errString.includes('overloaded') ||
    errString.includes('not found') ||
    errString.includes('internal error') ||
    errString.includes('timed out') ||
    errString.includes('timeout') ||
    errMsg.includes('quota') ||
    errMsg.includes('rate limit') ||
    errMsg.includes('timed out')
  );
}

export interface StructuredFallbackResult<T> {
  data: T;
  rawText: string;
  modelUsed: string;
  fallbackUsed: boolean;
  attemptsCount: number;
  latencyMs: number;
}

/**
 * Reusable Structured Generation Gateway across all AI features (Milestones 8 & 9)
 * Encapsulates the constitution-mandated 4-tier model ladder, recoverable error detection,
 * retry telemetry, and privacy-first error redaction.
 */
export async function generateStructuredContentWithFallback<T>({
  contents,
  systemInstruction,
  temperature = 0.7,
  validator,
}: {
  contents: Array<{ role: string; parts: Array<{ text: string }> }>;
  systemInstruction: string;
  temperature?: number;
  validator: (rawJson: unknown) => T;
}): Promise<StructuredFallbackResult<T>> {
  const startTime = Date.now();
  const ai = getAiClient();
  let lastError: unknown = null;

  for (let i = 0; i < MODEL_FALLBACK_LADDER.length; i++) {
    const model = MODEL_FALLBACK_LADDER[i];
    const attemptStartTime = Date.now();

    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            temperature,
          },
        }),
        GEMINI_ATTEMPT_TIMEOUT_MS,
        `Gemini attempt (${model})`
      );

      const rawText = response.text || '';
      const latencyMs = Date.now() - startTime;

      // Parse JSON safely
      let rawJson: unknown = null;
      try {
        rawJson = JSON.parse(rawText);
      } catch {
        rawJson = { raw: rawText };
      }

      // Execute caller's domain-specific validator
      const validatedData = validator(rawJson);

      const fallbackUsed = i > 0;
      if (fallbackUsed) {
        console.info(`[GEMINI FALLBACK SUCCESS] Succeeded on fallback model: ${model} (attempt ${i + 1})`);
      }

      return {
        data: validatedData,
        rawText,
        modelUsed: model,
        fallbackUsed,
        attemptsCount: i + 1,
        latencyMs,
      };
    } catch (err: unknown) {
      lastError = err;
      const attemptDuration = Date.now() - attemptStartTime;

      if (isRecoverableError(err) && i < MODEL_FALLBACK_LADDER.length - 1) {
        console.warn(
          `[GEMINI FALLBACK] Model ${model} failed after ${attemptDuration}ms. Recovering with next model (${MODEL_FALLBACK_LADDER[i + 1]})...`
        );
        continue;
      }

      break;
    }
  }

  console.error('[GEMINI CRITICAL] All configured fallback models failed to generate structured content.');
  const errorMsg = lastError instanceof Error ? lastError.message : 'Unknown AI generation failure';
  const sanitizedMsg = redactSecrets(errorMsg);
  throw new Error(`AI service temporarily unavailable: ${sanitizedMsg}`);
}

/**
 * Reusable fallback helper for Journal Reflections (Milestone 8)
 */
export async function generateContentWithFallback({
  prompt,
  history = [],
}: {
  prompt: string;
  history?: ConversationTurn[];
}): Promise<FallbackResult> {
  // Construct Gemini multi-turn content array with strict prompt boundary
  const contents = [];

  // Previous conversation turns (validated by route middleware)
  for (const turn of history) {
    contents.push({
      role: turn.role,
      parts: [{ text: turn.role === 'user' ? `<user_reflection>${turn.text}</user_reflection>` : turn.text }],
    });
  }

  // Active prompt wrapped in XML boundary tags for prompt injection defense
  contents.push({
    role: 'user',
    parts: [{ text: `<user_reflection>\n${prompt}\n</user_reflection>` }],
  });

  const result = await generateStructuredContentWithFallback<{
    reflection: string;
    insights: JournalReflectionInsights;
  }>({
    contents,
    systemInstruction: SYSTEM_INSTRUCTION,
    temperature: 0.7,
    validator: (rawJson) => validateAndSanitizeReflection(rawJson, prompt),
  });

  return {
    text: result.data.reflection,
    insights: result.data.insights,
    modelUsed: result.modelUsed,
    fallbackUsed: result.fallbackUsed,
    attemptsCount: result.attemptsCount,
    latencyMs: result.latencyMs,
  };
}
