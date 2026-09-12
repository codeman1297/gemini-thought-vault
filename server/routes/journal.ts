/**
 * Journal API Routes
 * 
 * Production Security Rules:
 * 1. Protected by verifyFirebaseToken middleware.
 * 2. Identity derived strictly from req.user.uid.
 * 3. Strict payload validation and character limits.
 * 4. User-based in-memory rate limiting.
 * 5. Structured output matching future Firestore schema.
 * 6. Privacy-first audit logging (zero journal text in logs).
 */

import { Router, type Response } from 'express';
import { verifyFirebaseToken } from '../middleware/auth';
import { generateContentWithFallback } from '../services/gemini';
import type { 
  AuthenticatedRequest, 
  JournalChatRequestBody, 
  ConversationTurn 
} from '../types';

const router = Router();

// In-memory sliding window rate-limiter: max 15 requests per minute per UID
const userRateLimits = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 15;

function checkRateLimit(uid: string): boolean {
  const now = Date.now();
  const timestamps = userRateLimits.get(uid) || [];
  
  // Prune expired timestamps
  const activeTimestamps = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  
  if (activeTimestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    userRateLimits.set(uid, activeTimestamps);
    return false; // Rate limit exceeded
  }

  activeTimestamps.push(now);
  userRateLimits.set(uid, activeTimestamps);
  return true;
}

// Clean up stale rate limits every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [uid, timestamps] of userRateLimits.entries()) {
    const active = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (active.length === 0) {
      userRateLimits.delete(uid);
    } else {
      userRateLimits.set(uid, active);
    }
  }
}, 5 * 60 * 1000);

/**
 * POST /api/journal/chat
 * Authenticated multi-turn reflection endpoint
 */
router.post('/chat', verifyFirebaseToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || !user.uid) {
    res.status(401).json({ error: 'Unauthorized: Missing user authentication context.', code: 'UNAUTHORIZED' });
    return;
  }

  // Enforce rate limiting
  if (!checkRateLimit(user.uid)) {
    res.status(429).json({
      error: 'Too many reflection requests. Please wait a moment before sharing your next thought.',
      code: 'RATE_LIMIT_EXCEEDED'
    });
    return;
  }

  // Defensive request body inspection
  const body = (req.body && typeof req.body === 'object') ? (req.body as JournalChatRequestBody) : {};
  const rawPrompt = body.prompt;

  if (!rawPrompt || typeof rawPrompt !== 'string') {
    res.status(400).json({
      error: 'Invalid request: "prompt" string is required.',
      code: 'INVALID_PROMPT'
    });
    return;
  }

  const prompt = rawPrompt.trim();
  if (prompt.length === 0) {
    res.status(400).json({
      error: 'Prompt cannot be empty.',
      code: 'EMPTY_PROMPT'
    });
    return;
  }

  if (prompt.length > 10000) {
    res.status(400).json({
      error: 'Journal reflection exceeds maximum allowed length (10,000 characters).',
      code: 'PROMPT_TOO_LONG'
    });
    return;
  }

  // Validate conversation history if provided
  const validatedHistory: ConversationTurn[] = [];
  let totalHistoryLength = 0;

  if (body.history) {
    if (!Array.isArray(body.history)) {
      res.status(400).json({
        error: 'Invalid request: "history" must be an array of conversation turns.',
        code: 'INVALID_HISTORY'
      });
      return;
    }

    if (body.history.length > 10) {
      res.status(400).json({
        error: 'Conversation history exceeds maximum of 10 turns per active session.',
        code: 'HISTORY_TOO_LONG'
      });
      return;
    }

    for (const turn of body.history) {
      if (!turn || typeof turn !== 'object') continue;
      const role = turn.role;
      const text = typeof turn.text === 'string' ? turn.text.trim() : '';

      if (role !== 'user' && role !== 'model') {
        res.status(400).json({
          error: 'Invalid conversation turn role. Must be "user" or "model".',
          code: 'INVALID_ROLE'
        });
        return;
      }

      if (text.length > 10000) {
        res.status(400).json({
          error: 'History turn exceeds maximum character limit (10,000 characters).',
          code: 'HISTORY_TURN_TOO_LONG'
        });
        return;
      }

      totalHistoryLength += text.length;
      validatedHistory.push({ role, text });
    }

    if (totalHistoryLength + prompt.length > 35000) {
      res.status(400).json({
        error: 'Total conversation payload exceeds size limits. Start a new reflection thread.',
        code: 'PAYLOAD_LIMIT_EXCEEDED'
      });
      return;
    }
  }

  try {
    const result = await generateContentWithFallback({
      prompt,
      history: validatedHistory,
    });

    // Privacy-first non-sensitive audit log
    console.info(
      `[JOURNAL AUDIT] User: ${user.uid.slice(0, 8)}... | Model: ${result.modelUsed} | Fallback: ${result.fallbackUsed} | Attempts: ${result.attemptsCount} | Duration: ${result.latencyMs}ms`
    );

    // Return structured response (compatible with future Milestone 5 Firestore documents)
    res.status(200).json({
      success: true,
      data: {
        userPrompt: prompt,
        geminiResponse: result.text,
        insights: result.insights,
        modelMetadata: {
          modelUsed: result.modelUsed,
          fallbackUsed: result.fallbackUsed,
          attemptsCount: result.attemptsCount,
          latencyMs: result.latencyMs,
        },
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown AI service failure';
    console.error(`[JOURNAL ERROR] User: ${user.uid.slice(0, 8)}... | Error: ${errorMsg}`);

    res.status(503).json({
      error: 'The AI Reflection companion is temporarily unavailable. Your draft has been preserved. Please try again in a moment.',
      code: 'AI_SERVICE_UNAVAILABLE'
    });
  }
});

export default router;
