/**
 * Journal API Routes
 * Milestone 5: Persistent Cloud Firestore Storage & Authoritative History
 * 
 * Production Security Rules:
 * 1. Protected by verifyFirebaseToken middleware; identity derived strictly from req.user.uid.
 * 2. Absolute User Isolation: Thread and interaction operations scoped to /users/${req.user.uid}/...
 * 3. Authoritative History: Conversation history for Gemini is loaded from Firestore, not client payloads.
 * 4. Idempotency: Prevents duplicate interaction persistence via clientInteractionId.
 * 5. Explicit Persistence Handling: Returns persistence status; supports Retry Save on transient DB issues.
 * 6. Privacy-first audit logging (zero journal text in logs).
 */

import { Router, type Response } from 'express';
import { verifyFirebaseToken } from '../middleware/auth';
import { generateContentWithFallback } from '../services/gemini';
import { validateAndSanitizeReflection } from '../services/reflectionEngine';
import { redactSecrets } from '../lib/config';
import { 
  listUserThreads, 
  getUserThread, 
  getThreadInteractions, 
  loadAuthoritativeGeminiHistory,
  checkInteractionExists,
  createThread, 
  persistInteraction,
  retrySaveInteraction 
} from '../services/journalStore';
import type { 
  AuthenticatedRequest, 
  JournalChatRequestBody, 
  CreateThreadRequestBody,
  RetrySaveRequestBody,
  JournalInteraction
} from '../types';

import { BoundedRateLimiter } from '../lib/rateLimit';

const router = Router();

// Bounded in-memory sliding window rate-limiter: max 15 requests per minute per UID
export const journalRateLimiter = new BoundedRateLimiter({
  name: 'journal-chat',
  maxRequests: 15,
  windowMs: 60 * 1000,
  maxKeys: 5000,
});

export function checkRateLimit(uid: string): boolean {
  return journalRateLimiter.check(uid);
}

export function resetJournalRateLimits(): void {
  journalRateLimiter.reset();
}

/**
 * GET /api/journal/threads
 * List all journal threads owned by the authenticated user
 */
router.get('/threads', verifyFirebaseToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || !user.uid) {
    res.status(401).json({ error: 'Unauthorized: Missing user authentication context.', code: 'UNAUTHORIZED' });
    return;
  }

  try {
    const threads = await listUserThreads(user.uid);
    res.status(200).json({
      success: true,
      threads,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to retrieve threads';
    console.error(`[JOURNAL THREADS ERROR] User: ${user.uid.slice(0, 8)}... | Error: ${errorMsg}`);
    res.status(500).json({
      error: 'Unable to retrieve your journal threads at this time.',
      code: 'THREADS_FETCH_FAILED'
    });
  }
});

/**
 * POST /api/journal/threads
 * Create a new user-scoped journal thread (optionally with an opening prompt)
 */
router.post('/threads', verifyFirebaseToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || !user.uid) {
    res.status(401).json({ error: 'Unauthorized: Missing user authentication context.', code: 'UNAUTHORIZED' });
    return;
  }

  const body = (req.body && typeof req.body === 'object') ? (req.body as CreateThreadRequestBody) : {};
  const rawTitle = typeof body.title === 'string' ? body.title.trim() : '';
  const rawPrompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const clientInteractionId = typeof body.clientInteractionId === 'string' ? body.clientInteractionId.trim() : undefined;

  try {
    // 1. Create the new thread document under /users/${uid}/threads
    const newThread = await createThread(user.uid, {
      title: rawTitle || (rawPrompt ? rawPrompt.slice(0, 40) + '...' : 'New Thought Thread'),
      previewSnippet: rawPrompt.slice(0, 150),
    });

    // If opening prompt was supplied, generate initial reflection turn
    if (rawPrompt) {
      if (rawPrompt.length > 10000) {
        res.status(400).json({
          error: 'Prompt exceeds maximum allowed length (10,000 characters).',
          code: 'PROMPT_TOO_LONG'
        });
        return;
      }

      if (!checkRateLimit(user.uid)) {
        res.status(429).json({
          error: 'Rate limit exceeded. Please wait a moment before sending your prompt.',
          code: 'RATE_LIMIT_EXCEEDED'
        });
        return;
      }

      const aiResult = await generateContentWithFallback({
        prompt: rawPrompt,
        history: [],
      });

      // Persist opening interaction
      const interaction = await persistInteraction({
        uid: user.uid,
        threadId: newThread.id,
        userPrompt: rawPrompt,
        geminiResponse: aiResult.text,
        insights: aiResult.insights,
        modelMetadata: {
          modelUsed: aiResult.modelUsed,
          fallbackUsed: aiResult.fallbackUsed,
          attemptsCount: aiResult.attemptsCount,
          latencyMs: aiResult.latencyMs,
        },
        clientInteractionId,
        turnIndex: 0,
      });

      res.status(201).json({
        success: true,
        thread: {
          ...newThread,
          turnCount: 1,
          coreThemes: aiResult.insights.coreThemes,
          lastInteractionId: interaction.id,
        },
        interaction,
        persistence: {
          status: 'persisted',
          savedAt: interaction.createdAt,
          interactionId: interaction.id,
          threadId: newThread.id,
        },
      });
      return;
    }

    // Return empty thread
    res.status(201).json({
      success: true,
      thread: newThread,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to create thread';
    console.error(`[JOURNAL THREAD CREATE ERROR] User: ${user.uid.slice(0, 8)}... | Error: ${errorMsg}`);
    res.status(500).json({
      error: 'Unable to create a new journal thread.',
      code: 'THREAD_CREATE_FAILED'
    });
  }
});

/**
 * GET /api/journal/threads/:threadId
 * Retrieve a specific thread and its authoritative chronological interactions
 */
router.get('/threads/:threadId', verifyFirebaseToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || !user.uid) {
    res.status(401).json({ error: 'Unauthorized: Missing user authentication context.', code: 'UNAUTHORIZED' });
    return;
  }

  const threadId = req.params.threadId;
  if (!threadId || typeof threadId !== 'string') {
    res.status(400).json({ error: 'Invalid thread ID parameter.', code: 'INVALID_THREAD_ID' });
    return;
  }

  try {
    const thread = await getUserThread(user.uid, threadId);
    if (!thread) {
      // 404: Fail-closed. Does not disclose if thread belongs to another user
      res.status(404).json({
        error: 'Thread not found or unauthorized.',
        code: 'THREAD_NOT_FOUND'
      });
      return;
    }

    const interactions = await getThreadInteractions(user.uid, threadId);

    res.status(200).json({
      success: true,
      thread,
      interactions,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to fetch thread details';
    console.error(`[JOURNAL THREAD FETCH ERROR] User: ${user.uid.slice(0, 8)}... | Error: ${errorMsg}`);
    res.status(500).json({
      error: 'Unable to retrieve thread details.',
      code: 'THREAD_FETCH_FAILED'
    });
  }
});

/**
 * POST /api/journal/chat
 * Authenticated multi-turn reflection endpoint
 * Milestone 5 Enhancements:
 * - Scoped to user's thread
 * - Loads authoritative history from Firestore (discards client-supplied history)
 * - Idempotency protection via clientInteractionId
 * - Atomic persistence into Firestore
 * - Explicit persistence status & fallback handling
 */
router.post('/chat', verifyFirebaseToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || !user.uid) {
    res.status(401).json({ error: 'Unauthorized: Missing user authentication context.', code: 'UNAUTHORIZED' });
    return;
  }

  // Rate limiting check
  if (!checkRateLimit(user.uid)) {
    res.status(429).json({
      error: 'Too many reflection requests. Please wait a moment before sharing your next thought.',
      code: 'RATE_LIMIT_EXCEEDED'
    });
    return;
  }

  // Inspect request body
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

  const clientInteractionId = typeof body.clientInteractionId === 'string' && body.clientInteractionId.trim()
    ? body.clientInteractionId.trim()
    : undefined;

  try {
    // 1. Resolve or Create Target Thread
    let targetThreadId = body.threadId;
    let turnIndex = 0;

    if (targetThreadId) {
      const existingThread = await getUserThread(user.uid, targetThreadId);
      if (!existingThread) {
        res.status(404).json({
          error: 'Thread not found or unauthorized.',
          code: 'THREAD_NOT_FOUND'
        });
        return;
      }

      // Check Idempotency: Has this interaction already been persisted?
      if (clientInteractionId) {
        const existingInteraction = await checkInteractionExists(user.uid, targetThreadId, clientInteractionId);
        if (existingInteraction) {
          console.info(`[JOURNAL IDEMPOTENT] Returned existing interaction ${clientInteractionId} for user ${user.uid.slice(0, 8)}`);
          res.status(200).json({
            success: true,
            data: {
              userPrompt: existingInteraction.userPrompt,
              geminiResponse: existingInteraction.geminiResponse,
              insights: existingInteraction.insights,
              modelMetadata: existingInteraction.modelMetadata,
              threadId: targetThreadId,
              interactionId: existingInteraction.id,
              turnIndex: existingInteraction.turnIndex,
              persistence: {
                status: 'persisted',
                savedAt: existingInteraction.createdAt,
                interactionId: existingInteraction.id,
                threadId: targetThreadId,
              },
              timestamp: existingInteraction.createdAt,
            },
          });
          return;
        }
      }

      const existingInteractions = await getThreadInteractions(user.uid, targetThreadId);
      turnIndex = existingInteractions.length;
    } else {
      // Auto-create a thread if none provided
      const newThread = await createThread(user.uid, {
        title: prompt.slice(0, 40) + '...',
        previewSnippet: prompt.slice(0, 150),
      });
      targetThreadId = newThread.id;
      turnIndex = 0;
    }

    // 2. Load Authoritative History from Firestore (Discard client-provided history)
    const authoritativeHistory = await loadAuthoritativeGeminiHistory(user.uid, targetThreadId, 5);

    // 3. Invoke Gemini with Constitution Fallback Ladder
    const aiResult = await generateContentWithFallback({
      prompt,
      history: authoritativeHistory,
    });

    console.info(
      `[JOURNAL AUDIT] User: ${user.uid.slice(0, 8)}... | Model: ${aiResult.modelUsed} | Fallback: ${aiResult.fallbackUsed} | Attempts: ${aiResult.attemptsCount} | Duration: ${aiResult.latencyMs}ms`
    );

    // 4. Persist Interaction to Firestore with Atomic Thread Metadata Update
    let persistedInteraction: JournalInteraction | null = null;
    let persistenceFailed = false;

    try {
      persistedInteraction = await persistInteraction({
        uid: user.uid,
        threadId: targetThreadId,
        userPrompt: prompt,
        geminiResponse: aiResult.text,
        insights: aiResult.insights,
        modelMetadata: {
          modelUsed: aiResult.modelUsed,
          fallbackUsed: aiResult.fallbackUsed,
          attemptsCount: aiResult.attemptsCount,
          latencyMs: aiResult.latencyMs,
        },
        clientInteractionId,
        turnIndex,
      });
    } catch (dbErr: unknown) {
      persistenceFailed = true;
      const dbMsg = dbErr instanceof Error ? dbErr.message : 'Database write failure';
      console.error(`[PERSISTENCE ERROR] User: ${user.uid.slice(0, 8)}... | Error: ${dbMsg}`);
    }

    // 5. Handle Persistence Failure Explicitly
    if (persistenceFailed || !persistedInteraction) {
      res.status(500).json({
        error: 'Your AI reflection was generated, but saving to your ThoughtVault failed. Please use Retry Save.',
        code: 'DATABASE_PERSISTENCE_FAILED',
        pendingRecord: {
          threadId: targetThreadId,
          clientInteractionId: clientInteractionId || `int_${Date.now()}`,
          userPrompt: prompt,
          geminiResponse: aiResult.text,
          insights: aiResult.insights,
          modelMetadata: {
            modelUsed: aiResult.modelUsed,
            fallbackUsed: aiResult.fallbackUsed,
            attemptsCount: aiResult.attemptsCount,
            latencyMs: aiResult.latencyMs,
          },
          failedAt: new Date().toISOString(),
        }
      });
      return;
    }

    // 6. Confirmed Success Response
    res.status(200).json({
      success: true,
      data: {
        userPrompt: prompt,
        geminiResponse: aiResult.text,
        insights: aiResult.insights,
        modelMetadata: {
          modelUsed: aiResult.modelUsed,
          fallbackUsed: aiResult.fallbackUsed,
          attemptsCount: aiResult.attemptsCount,
          latencyMs: aiResult.latencyMs,
        },
        threadId: targetThreadId,
        interactionId: persistedInteraction.id,
        turnIndex: persistedInteraction.turnIndex,
        persistence: {
          status: 'persisted',
          savedAt: persistedInteraction.createdAt,
          interactionId: persistedInteraction.id,
          threadId: targetThreadId,
        },
        timestamp: persistedInteraction.createdAt,
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown AI service failure';
    console.error(`[JOURNAL ERROR] User: ${user.uid.slice(0, 8)}... | Error: ${redactSecrets(errorMsg)}`);

    res.status(503).json({
      error: 'The AI Reflection companion is temporarily unavailable. Your draft has been preserved. Please try again in a moment.',
      code: 'AI_SERVICE_UNAVAILABLE'
    });
  }
});

/**
 * POST /api/journal/retry-save
 * Explicit recovery endpoint for persisting previously generated AI reflections
 * without burning another Gemini API call
 */
router.post('/retry-save', verifyFirebaseToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = req.user;
  if (!user || !user.uid) {
    res.status(401).json({ error: 'Unauthorized: Missing user authentication context.', code: 'UNAUTHORIZED' });
    return;
  }

  const body = (req.body && typeof req.body === 'object') ? (req.body as RetrySaveRequestBody) : null;
  if (!body || !body.threadId || !body.userPrompt || !body.geminiResponse) {
    res.status(400).json({
      error: 'Invalid retry save payload: threadId, userPrompt, and geminiResponse are required.',
      code: 'INVALID_RETRY_PAYLOAD'
    });
    return;
  }

  try {
    // Validate and defensively sanitize insight fields before retrying persistence
    const rawReflectionObject = (body.insights && typeof body.insights === 'object')
      ? { ...body.insights, reflection: body.geminiResponse }
      : { reflection: body.geminiResponse };

    const { insights: sanitizedInsights } = validateAndSanitizeReflection(rawReflectionObject, body.userPrompt);

    const persisted = await retrySaveInteraction(user.uid, {
      ...body,
      insights: sanitizedInsights,
    });
    res.status(200).json({
      success: true,
      interaction: persisted,
      persistence: {
        status: 'persisted',
        savedAt: persisted.createdAt,
        interactionId: persisted.id,
        threadId: body.threadId,
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Retry save failed';
    console.error(`[RETRY SAVE ERROR] User: ${user.uid.slice(0, 8)}... | Error: ${errorMsg}`);
    res.status(500).json({
      error: 'Failed to persist journal entry on retry.',
      code: 'RETRY_PERSISTENCE_FAILED'
    });
  }
});

export default router;
