# Gemini ThoughtVault — Final Demo & Ideathon Walkthrough Guide

**Project**: Gemini ThoughtVault / Personal Gemini Journal  
**Challenge**: Google H2S GenAI APAC Edition Cohort 3 — Accelerate AI with Cloud Run Ideathon  
**Challenge Label**: `dev-tutorial=cloud-run-ai-challenge`  
**Deployment Target**: Google Cloud Run (`asia-southeast1`)  
**Security Standard**: 43-Point Production Security Constitution  

---

## 1. Flagship Demo Story Arc

The demonstration communicates a single, cohesive human-centric narrative that solves the core tension of personal journaling in the age of AI:

$$\text{"Capture a Thought"} \longrightarrow \text{"Understand the Thought"} \longrightarrow \text{"See How Thinking Evolves"} \longrightarrow \text{"Ask Questions of Your History"} \longrightarrow \text{"Discover Longitudinal Patterns"}$$

### The Core Problem
Personal journals contain our most sensitive, reflective, and valuable thoughts over time. Yet traditional chat interfaces and LLM wrappers present a dangerous dilemma:
1. **The Privacy Trap**: Sending private reflections to untrusted cloud services risks sensitive data leakage, training data ingestion, or multi-tenant cross-talk.
2. **The Amnesia Trap**: Standard AI chats are stateless or ephemeral; they cannot track how ideas mature across months or connect disparate thoughts into cohesive developmental insights.
3. **The Hallucination Trap**: General AI models speculate or fabricate history when asked about a user's past decisions.

### The Solution: Gemini ThoughtVault
A production-grade, privacy-first journal powered by **Google Gemini** on **Google Cloud Run**, with cryptographic **Firebase Authentication**, owner-bound **Cloud Firestore** storage, runtime secret injection via **Google Cloud Secret Manager**, and strict bounded retrieval that treats personal reflections with zero-trust isolation.

---

## 2. 3–5 Minute Live Demonstration Script

| Stage | Duration | Primary Action & Screen | Evaluator Speaking Points | Key UI / System Signals |
| :--- | :--- | :--- | :--- | :--- |
| **A. Opening** | 30s | Public Landing Page (`LandingPage.tsx`) | *"Personal journals are our most private thinking tools, but ordinary AI chats either compromise privacy or forget everything across sessions. Gemini ThoughtVault solves this with a zero-trust, authenticated architecture deployed on Cloud Run."* | • Architecture overview banner<br>• Public security assurances<br>• Fail-closed route guarding |
| **B. Authentication** | 30s | Click **"Sign In with Google"** | *"Authentication is anchored in Google Sign-In via Firebase Auth. The browser never specifies user identity; the server derives authorization strictly from verified cryptographic tokens."* | • Firebase popup authentication<br>• Session Identity Banner<br>• Truncated verified UID display |
| **C. Thought Capture** | 45s | Journal Workspace (`Dashboard.tsx`)<br>Enter a reflection prompt | *"Let's record a thought about career transition, leadership doubts, and learning Rust. As we submit, an idempotency token protects against duplicate writes, and our draft is safeguarded against network failures."* | • Character counter (max 10,000)<br>• Idempotent client interaction ID<br>• Non-destructive draft retention |
| **D. AI Reflection** | 45s | View Gemini Response & Structured Insights | *"Gemini analyzes the entry using our resilient 4-tier model ladder. Notice the structured reflection: Core Themes identified, Sentiment Trajectory analyzed, Open Reflective Questions posed, and Actionable Steps generated."* | • Model badge (`gemini-3.6-flash`)<br>• Firestore persistence badge (`CloudCheck`)<br>• Turn counter and latency metadata |
| **E. Thought Evolution** | 60s | Click **"Thought Evolution"** Tab (`ThoughtEvolutionView.tsx`)<br>Click **"Synthesize Evolution"** | *"Now let's zoom out to the macro level. Thought Evolution examines our historical entries across threads. Notice the distributed lock preventing race conditions, and SHA-256 canonical content hashing—if my journal hasn't changed, results return instantly with zero redundant Gemini API calls."* | • 90-second transactional lock status<br>• Macro themes & trajectory shifts<br>• Supporting Evidence Drawer dereferencing |
| **F. Ask My Journal** | 45s | Click **"Ask My Journal"** Tab / API Walkthrough | *"When we query past history—such as 'What have I decided regarding work-life balance?'—the system performs bounded retrieval over 25 threads and 150 candidate entries. Crucially, any hallucinated citations are automatically pruned by our server-side verification map."* | • Grounded RAG architecture display<br>• Strict evidence validation<br>• Single-instance in-flight coalescing |
| **G. Personal Insights** | 30s | Click **"Personal Insights"** Tab (`PersonalInsightsView.tsx`) | *"Personal Insights provides longitudinal trajectory mapping—tracking themes across developing, established, and dormant phases. Clicking 'Reflect on this' seeds our prompt canvas to continue the conversational loop."* | • 30-minute FIFO cache indicator<br>• Theme development lifecycle<br>• Interactive prompt injection |
| **H. Security Story** | 30s | Session Identity Banner & Architecture Summary | *"Behind this UI is an uncompromised security model: zero Gemini API keys in the browser, Secret Manager runtime injection on Cloud Run, and fail-closed Firestore rules where User A cannot ever read or touch User B's vault."* | • Verified UID root of trust<br>• Zero browser secrets<br>• Challenge label verification |

---

## 3. Technical Architecture Walkthrough

```
+---------------------------------------------------------------------------------------------------+
|                                      CLIENT BROWSER (React 19 SPA)                                 |
|                                                                                                   |
|  - Firebase Web SDK (Google Sign-In OAuth popup)                                                  |
|  - Cryptographic ID Token Acquisition (user.getIdToken())                                         |
|  - In-Memory Draft Preservation (Non-destructive UI state on network or persistence failure)      |
|  - Zero Secret Storage (ZERO Gemini API keys, ZERO service account credentials)                   |
+-------------------------------------------------+-------------------------------------------------+
                                                  |
                                                  | HTTPS / TLS 1.3 (Port 3000)
                                                  | Authorization: Bearer <firebase_id_token>
                                                  v
+---------------------------------------------------------------------------------------------------+
|                                 GOOGLE CLOUD RUN (Port 3000)                                      |
|                                                                                                   |
|  [Security Perimeter & Ingress]                                                                   |
|  - Bounded Ingress (0.0.0.0:3000, 64kb max request body)                                          |
|  - Security Response Headers (CSP, HSTS, X-Content-Type-Options: nosniff, SAMEORIGIN, Permissions) |
|  - In-Memory Sliding-Window Rate Limiters (Chat: 15/min, Ask: 10/min, Evolution: 4/min per UID)   |
|                                                                                                   |
|  [Cryptographic Identity Middleware]                                                              |
|  - verifyFirebaseToken / requireAuth decodes & validates token via Firebase Admin SDK             |
|  - Derives authoritative identity: req.user.uid (Strictly ignores any client-supplied userId)     |
|                                                                                                   |
|  [Core Engines & Resilience Orchestration]                                                        |
|  - JournalStore: Idempotent database transactions and authoritative history retrieval              |
|  - ReflectionEngine: Top-level systemInstruction separation & defensive JSON schema validation    |
|  - EvolutionEngine: 90s distributed lock (/evolution/lock), pre-commit fencing, SHA-256 hash       |
|  - AskRetrieval & AskSynthesis: Bounded candidate scoring, citation pruning, in-flight coalescing  |
|  - Automated Secret Redactor: Scrubs API keys, Bearer tokens, and emails from all runtime logs     |
+--------------------------+-------------------------------------+----------------------------------+
                           |                                     |
             Admin SDK     | Scoped strictly to                  | Runtime Secret Injection
             IAM Auth      | /users/{verifiedUid}/...            | (--set-secrets at container boot)
                           v                                     v
+--------------------------------------------+    +-------------------------------------------------+
|           GOOGLE CLOUD FIRESTORE           |    |          GOOGLE CLOUD SECRET MANAGER            |
|                                            |    |                                                 |
|  /users/{userId}                           |    |  Secret Name: gemini-thoughtvault-api-key       |
|    |-- /threads/{threadId}                 |    |  Mounted to Cloud Run container env:            |
|    |     |-- /interactions/{id}            |    |  GEMINI_API_KEY (Server-side only)              |
|    |     |-- /reflections/{id}             |    |  IAM: roles/secretmanager.secretAccessor        |
|    |-- /evolution/latest                   |    +------------------------+------------------------+
|    |-- /evolution/lock (Admin only)        |                             |
|    |-- /ask_cache/{cacheKey} (Admin only)  |                             v
|    |-- /insight_cache/{id} (Admin only)    |    +-------------------------------------------------+
|                                            |    |                GOOGLE GEMINI API                |
|  Security Rules (firestore.rules):         |    |                                                 |
|  - Owner-Bound: request.auth.uid == userId |    |  4-Tier Resilient Fallback Ladder:              |
|  - Internal Caches & Locks: allow: false   |    |  1. Primary:    gemini-3.6-flash                |
|  - Default Deny: match /{document=**}      |    |  2. Fallback 1: gemini-3.1-flash-lite           |
|    allow read, write: if false;            |    |  3. Fallback 2: gemini-flash-latest             |
|                                            |    |  4. Fallback 3: gemini-3.7-flash                |
+--------------------------------------------+    +-------------------------------------------------+
```

### Key Architectural Tenets
1. **Verified Firebase UID as Root of Trust**: All Firestore paths and business logic are keyed to `req.user.uid` extracted from the cryptographically verified token. Client-supplied IDs in bodies, URLs, or query parameters are ignored or validated for exact match.
2. **Journal Content is Untrusted Data**: When user reflections are provided to Gemini for reflection or synthesis, they are demarcated with inert boundary tags (`<user_reflection>`, `<historical_entries>`), while application directives are anchored exclusively in the top-level `systemInstruction` configuration. Gemini is granted zero tool-execution or shell capabilities.
3. **Defense-in-Depth Output Handling**: Generated content is parsed through rigid JSON schema constraints and inspected by server-side validators before persistence. Hallucinated evidence citation IDs are pruned against the live retrieval map.

---

## 4. Evaluator Security Demonstration Walkthrough

When evaluating the security posture of Gemini ThoughtVault, run or review these specific test scenarios:

### 1. Cross-User Data Isolation (Anti-IDOR)
- **Scenario**: User A attempts to read User B's thread (`GET /api/journal/threads/{userB_threadId}`).
- **Outcome**: Handled fail-closed. The query verifies `threadDoc.data().userId === req.user.uid`. If mismatched, returns `HTTP 403 FORBIDDEN` (`FORBIDDEN_ACCESS`).
- **Evidence**: Verified in automated test suite `server/test/e2eProductionVerification.test.ts`.

### 2. Client UID Spoofing Rejection
- **Scenario**: An attacker sends `{ "userId": "victim_uid" }` or modifies query parameters to hijack another user's vault.
- **Outcome**: The server ignores all client-supplied identity fields and strictly utilizes `req.user.uid` from Firebase Admin token decoding.
- **Evidence**: Verified in `server/test/apiHardening.test.ts`.

### 3. Unauthenticated Access Rejection
- **Scenario**: An unauthenticated request attempts to call `/api/journal/threads` without a Bearer token.
- **Outcome**: The `requireAuth` middleware immediately halts execution and returns `HTTP 401 UNAUTHORIZED`.
- **Evidence**: Verified in `server/test/productionHardening.test.ts`.

### 4. Stale / Deleted Evidence Dereferencing Guard
- **Scenario**: An evolution report cites an interaction that was subsequently deleted from the user's journal.
- **Outcome**: `/api/journal/evolution/evidence/:threadId/:interactionId` executes `getSupportingInteractionEvidence()`, detects the missing document, and returns `{ available: false, message: 'This thought entry is no longer available in your journal.' }`. Ghost data is never served.
- **Evidence**: Verified in `server/test/evolutionEngine.test.ts`.

### 5. Hallucinated AI Citation ID Pruning
- **Scenario**: Gemini invents a plausible but non-existent interaction ID during Ask My Journal or Personal Insights synthesis.
- **Outcome**: The server cross-references all cited IDs against the in-memory retrieval map (`verifiedMap`). Any ID not found in the verified candidates is discarded.
- **Evidence**: Verified in `server/test/askSynthesis.test.ts`.

### 6. Private Cache & Distributed Lock Shielding
- **Scenario**: A client attempts to read `/users/{uid}/ask_cache` or `/users/{uid}/evolution/lock` via the client Firestore SDK.
- **Outcome**: Blocked by `firestore.rules` (`match /users/{userId}/evolution/{doc=**} { allow read, write: if false; }`). Internal operational data is accessible exclusively by server-side Firebase Admin SDK.
- **Evidence**: Verified in `server/test/firebaseFirestoreAudit.test.ts`.

### 7. Zero Client-Side Secret Exposure
- **Scenario**: Inspect browser bundle, environment files, and network traffic for `GEMINI_API_KEY`.
- **Outcome**: The Gemini API key exists exclusively on the Cloud Run server, injected via Secret Manager. Zero `VITE_GEMINI_*` environment variables exist.
- **Evidence**: Verified by static grep analysis and `server/lib/config.ts`.

### 8. Sensitive Server Bundle Blocking
- **Scenario**: An attacker requests `/server.cjs`, `/.env`, or `/package.json` directly from the web server.
- **Outcome**: The Express static shielding handler explicitly intercepts sensitive filenames and returns `HTTP 404 NOT FOUND`.
- **Evidence**: Verified in `server/test/apiHardening.test.ts`.

### 9. Bounded Payload & Anti-DoS Enforcement
- **Scenario**: A client submits a payload larger than 64kb or a prompt exceeding 10,000 characters.
- **Outcome**: The Express parser rejects oversized payloads with `HTTP 413` or `HTTP 400` (`PROMPT_TOO_LONG`).
- **Evidence**: Verified in `server/test/apiHardening.test.ts`.

### 10. Instance-Local Sliding-Window Rate Limiting
- **Scenario**: A user fires rapid-fire requests exceeding limits (Chat: 15/min, Ask: 10/min, Evolution: 4/min, Insights: 4/min).
- **Outcome**: Returns `HTTP 429 RATE_LIMIT_EXCEEDED` with retry guidance, protecting backend resources and Gemini quotas.
- **Evidence**: Verified in `server/test/reliabilityObservability.test.ts`.

> **Auditor Note on Security Claims**: No exploitable cross-user IDOR was identified in the audited routes under verified Firebase authentication context. Security claims represent verified boundaries enforced by tested code rather than unsupportable absolutes.

---

## 5. Canonical Cloud Run Deployment Specification

To deploy Gemini ThoughtVault to Google Cloud Run, execute this canonical command sequence:

```bash
# 1. Export canonical configuration
export PROJECT_ID="your-gcp-project-id"
export REGION="asia-southeast1"
export SERVICE_NAME="gemini-thoughtvault"
export SA_NAME="thoughtvault-runner"
export SECRET_NAME="gemini-thoughtvault-api-key"

gcloud config set project "${PROJECT_ID}"

# 2. Deploy to Google Cloud Run
gcloud run deploy "${SERVICE_NAME}" \
  --source="." \
  --region="${REGION}" \
  --platform="managed" \
  --service-account="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --set-secrets="GEMINI_API_KEY=${SECRET_NAME}:latest" \
  --set-labels="dev-tutorial=cloud-run-ai-challenge" \
  --allow-unauthenticated \
  --ingress="all" \
  --port=3000 \
  --cpu=1 \
  --memory=512Mi \
  --concurrency=80 \
  --timeout=60s \
  --max-instances=10 \
  --min-instances=0
```

### Verification of the Challenge Label
```bash
gcloud run services describe "${SERVICE_NAME}" \
  --region="${REGION}" \
  --format="value(metadata.labels)"
```
**Expected Output**:
```text
dev-tutorial=cloud-run-ai-challenge
```

---

## 6. Evaluator Verification Checklist

Use this 14-point checklist to independently verify the complete Gemini ThoughtVault implementation:

- [ ] **1. Google Sign-In Works**: Authenticates via Firebase Web SDK; session resolves with verified UID in Session Identity Banner.
- [ ] **2. Gemini Interaction Works**: Prompt generates multi-turn response through server-side Gemini SDK using fallback ladder.
- [ ] **3. Journal Persistence Works**: Prompts, responses, and metadata persist authoritatively to Cloud Firestore (`users/{uid}/threads/{threadId}/interactions/{id}`).
- [ ] **4. Reflection Works**: Structured insights (`coreThemes`, `sentimentTrajectory`, `openQuestions`, `actionableSteps`) generate and display inline.
- [ ] **5. Thought Evolution Works**: Computes longitudinal report across threads with 90s transactional lock, canonical content hashing, and supporting evidence drawer.
- [ ] **6. Ask My Journal Works**: REST endpoint (`POST /api/journal/ask`) executes bounded retrieval (25 threads, 150 interactions), prunes hallucinated citations, and coalesces in-flight queries.
- [ ] **7. Personal Insights Works**: Longitudinal analysis displays developing/established/dormant themes with 30-minute FIFO cache and reflection prompt injection.
- [ ] **8. User Isolation Verified**: Cross-user Firestore reads/writes are blocked by `firestore.rules`; server rejects client-supplied UID tampering (`HTTP 403`).
- [ ] **9. Secret Manager Configured**: `GEMINI_API_KEY` is injected at container boot from secret `gemini-thoughtvault-api-key`; zero keys in client code or Git.
- [ ] **10. Cloud Run Deployed**: Service configured in region `asia-southeast1` with port 3000, 1 CPU, 512Mi memory, concurrency 80, and timeout 60s.
- [ ] **11. Cloud Run Label Applied**: Service metadata confirms label `dev-tutorial=cloud-run-ai-challenge`.
- [ ] **12. Production URL Tested**: `/health` and `/api/health` return HTTP 200 with JSON status payload and security headers.
- [ ] **13. README Contains Deployment Instructions**: Step-by-step instructions for GCP project setup, Secret Manager, Cloud Run, and Firestore deployment are documented.
- [ ] **14. GitHub Repository Ready**: Clean repository state with zero secrets, strict `.gitignore`, multi-stage `Dockerfile`, and 13 automated test suites.
