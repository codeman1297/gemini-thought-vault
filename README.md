# Gemini ThoughtVault

> A production-oriented, user-authenticated personal AI journaling application that allows users to privately converse with Gemini, persist journal interactions in Cloud Firestore, and uncover insights with fail-closed security.

Deployed to **Google Cloud Run** with **Firebase Authentication (Google Sign-In)**, **Cloud Firestore**, **Google Cloud Secret Manager**, and the **Gemini AI API**.

---

## 1. Problem & Solution

### The Problem
Personal journaling contains some of an individual's most intimate thoughts, emotions, and vulnerabilities. While conversational AI can provide reflective guidance, commercial chatbots often lack strict user data boundaries, store prompt history insecurely, expose API keys on the client-side, or lack atomic persistence guarantees.

### The Solution
**Gemini ThoughtVault** addresses this with a zero-trust, privacy-first architecture:
- **Absolute User Isolation**: Every journal thread and reflection is scoped strictly to the authenticated user's Firebase UID.
- **Server-Side AI Gateway**: Gemini API requests execute purely within the Cloud Run backend container. The browser never touches or receives the Gemini API key.
- **Secret Manager Runtime Injection**: Production secrets are injected into the container via Google Cloud Secret Manager (`gemini-thoughtvault-api-key`), with least-privilege IAM bindings.
- **Authoritative History**: Multi-turn conversation context for Gemini is loaded from Firestore on the server, preventing client-side history tampering.
- **Fail-Closed Persistence**: Explicit persistence state tracking with idempotent operations and "Retry Save" recovery.

---

## 2. Architecture Overview

```
                      +-----------------------------------+
                      |      Browser / Client SPA         |
                      |  React 18 + Vite + Tailwind CSS   |
                      +-----------------+-----------------+
                                        |
                          Firebase Auth | Google Sign-In
                                        v
                      +-----------------------------------+
                      |       Firebase Authentication     |
                      |    (Issues verified ID Token)     |
                      +-----------------+-----------------+
                                        |
                    HTTPS Bearer Token  | (Protected /api/*)
                                        v
                      +-----------------------------------+
                      |    Google Cloud Run (Port 3000)   |
                      |          Express Server           |
                      |  - verifyFirebaseToken Middleware |
                      |  - 64kb Payload Limiting          |
                      |  - Rate Limiter (15 req/min/UID)  |
                      |  - Automatic Log Redactor         |
                      +--------+------------------+-------+
                               |                  |
               Authoritative   |                  | Injected via
             Data Isolation    v                  | Secret Manager
         +---------------------+-------+          |
         | Google Cloud Firestore      |          v
         | /users/{uid}/threads/...    |   +--------------+
         | Rules: auth.uid == userId   |   | Secret Mgr   |
         +-----------------------------+   | (Secret:     |
                                           |  gemini-     |
                                           |  thought-    |
                                           |  vault-      |
                                           |  api-key)    |
                                           +------+-------+
                                                  |
                                                  v
                                      +-----------------------+
                                      | Google Gemini API     |
                                      | 4-Tier Fallback Ladder|
                                      | 1. gemini-3.6-flash   |
                                      | 2. gemini-3.1-fl.-lite|
                                      | 3. gemini-flash-latest|
                                      | 4. gemini-3.7-flash   |
                                      +-----------------------+
```

---

## 3. Technology Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend** | React 18, TypeScript, Tailwind CSS, Lucide Icons | Responsive, accessible journaling dashboard |
| **Backend** | Express 4, Node.js, TypeScript | Authenticated API gateway & security controls |
| **Authentication** | Firebase Auth (Google Sign-In Popup) | Federated, passwordless user authentication |
| **Identity Verification** | Firebase Admin SDK | Server-side cryptographic token verification |
| **Database** | Google Cloud Firestore | Owner-bound, user-isolated document persistence |
| **AI Engine** | Google GenAI SDK (`@google/genai`) | Multi-turn reflections & structured theme extraction |
| **Secret Management** | Google Cloud Secret Manager | Container runtime secret injection |
| **Hosting & Compute** | Google Cloud Run (Containerized) | Auto-scaling, managed container execution |

---

## 4. Security Architecture

### 4.1 Zero Secret Exposure
- The `GEMINI_API_KEY` is **strictly server-side**.
- No `VITE_GEMINI_API_KEY` exists anywhere in client code.
- In production, the key is mounted via `--set-secrets="GEMINI_API_KEY=gemini-thoughtvault-api-key:latest"`.
- All server logs pass through an automatic sanitizer (`redactSecrets`) that strips API keys and Bearer tokens.

### 4.2 Absolute User Data Isolation
- Client-supplied user IDs are **never trusted**.
- User identity is derived strictly from the verified Firebase ID token (`req.user.uid`).
- Firestore security rules strictly require `request.auth.uid == userId` for all paths:
  `/users/{userId}/threads/{threadId}/interactions/{interactionId}`.

### 4.3 4-Tier Gemini Model Fallback Ladder
In compliance with Section 14 of the Security Constitution:
1. **Primary**: `gemini-3.6-flash`
2. **Fallback 1**: `gemini-3.1-flash-lite`
3. **Fallback 2**: `gemini-flash-latest`
4. **Fallback 3**: `gemini-3.7-flash`
Handles recoverable errors (`429`, `503`, `404`, `500`, `RESOURCE_EXHAUSTED`, `UNAVAILABLE`) seamlessly.

### 4.4 Prompt Injection Defense
User journal inputs are delimited with strict XML boundary tags (`<user_reflection>`), preventing prompt escape or system instruction override attempts.

---

## 5. Google Cloud Secret Manager Setup

### Step 1: Create Secret
```bash
export PROJECT_ID="your-project-id"
export SECRET_NAME="gemini-thoughtvault-api-key"

gcloud secrets create "${SECRET_NAME}" \
  --replication-policy="automatic" \
  --project="${PROJECT_ID}"
```

### Step 2: Store API Key
```bash
echo -n "YOUR_GEMINI_API_KEY" | gcloud secrets versions add "${SECRET_NAME}" \
  --data-file=- \
  --project="${PROJECT_ID}"
```

### Step 3: Configure Dedicated Service Account & IAM
```bash
export SA_NAME="thoughtvault-runner"

# 1. Create dedicated service account
gcloud iam service-accounts create "${SA_NAME}" \
  --display-name="ThoughtVault Cloud Run Runner" \
  --project="${PROJECT_ID}"

# 2. Grant Secret Accessor ONLY on this specific secret (Least Privilege)
gcloud secrets add-iam-policy-binding "${SECRET_NAME}" \
  --member="serviceAccount:${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project="${PROJECT_ID}"

# 3. Grant Firestore access for database writes
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/datastore.user"
```

---

## 6. Cloud Run Deployment

Deploy with runtime secret injection and the required AI challenge verification label:

```bash
gcloud run deploy gemini-thoughtvault \
  --source="." \
  --region="asia-southeast1" \
  --platform="managed" \
  --service-account="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --set-secrets="GEMINI_API_KEY=${SECRET_NAME}:latest" \
  --set-labels="dev-tutorial=cloud-run-ai-challenge" \
  --allow-unauthenticated \
  --port=3000 \
  --memory=512Mi \
  --cpu=1
```

---

## 7. Local Development

### 1. Clone & Install
```bash
git clone https://github.com/your-repo/gemini-thoughtvault.git
cd gemini-thoughtvault
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Populate `.env` with:
- `GEMINI_API_KEY`: Your personal Gemini API key.
- `VITE_FIREBASE_*`: Your Firebase project public web credentials.

> `.env` is ignored by Git in `.gitignore` to prevent credential leakage.

### 3. Start Development Server
```bash
npm run dev
```
Open `http://localhost:3000`.

---

## 8. Firestore Security Rules

Deploy the owner-bound rules in `firestore.rules`:
```bash
firebase deploy --only firestore:rules
```

```javascript
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;

      match /threads/{threadId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;

        match /interactions/{interactionId} {
          allow read, write: if request.auth != null && request.auth.uid == userId;
        }
      }
    }
  }
}
```

---

## 9. Security Verification & Test Plan

| Test Case | Method | Expected Outcome |
| :--- | :--- | :--- |
| **Unauthenticated API Access** | `curl -X POST /api/journal/chat` without token | `401 Unauthorized` |
| **Tampered User ID** | Client passes forged `userId` parameter | Ignored. Identity derived strictly from token |
| **Cross-User Data Access** | User A queries User B's thread ID | `404 Thread not found or unauthorized` |
| **Secret Manager Ingestion** | Cloud Run boot logs | Verified key presence; zero secret chars logged |
| **Log Sanitization** | Deliberate exception with key pattern | Log scrubs key to `[REDACTED_API_KEY]` |
| **Persistence Recovery** | Network glitch during Firestore save | State kept in UI; "Retry Save" succeeds |

---

## 10. License

MIT License. Designed with security, privacy, and craftsmanship.
