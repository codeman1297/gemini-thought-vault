# Security Policy & Secret Hardening Guide

## Overview

**Gemini ThoughtVault** is an authenticated personal journaling application engineered with a strict, defense-in-depth security model. This document details the security architecture, threat model, Secret Manager integration, and IAM permissions designed to safeguard private user reflections.

---

## 1. Five Threat Zones & Mitigations

### Zone 1: Input Surfaces
- **Threat**: Malicious payloads, oversized inputs, and prompt injection attempts.
- **Mitigation**: Strict schema validation via TypeScript interfaces, 64kb HTTP payload cap on Express body-parser, 10,000-character cap on journal reflections, and strict XML isolation tags (`<user_reflection>`) preventing prompt escape.

### Zone 2: Planning & Reasoning (Gemini Interactions)
- **Threat**: Prompt injection attempting to manipulate model persona, leak system instructions, or execute arbitrary operations.
- **Mitigation**: Separation of application instructions (`systemInstruction`) from user-controlled content. Model responses are parsed strictly into structured JSON (`{ reflection, coreThemes, openQuestions }`) with non-executable typing.

### Zone 3: Tool & Service Execution
- **Threat**: Unauthorized API requests, SSRF, or uncontrolled third-party calls.
- **Mitigation**: Server-side proxy architecture (`/api/journal/*`). The browser has zero direct access to the Gemini API or service secrets. All outbound requests use official, vetted SDKs (`@google/genai`).

### Zone 4: Memory & State (Firestore Persistence)
- **Threat**: Cross-user data tampering, unauthorized thread access, or ID substitution.
- **Mitigation**: Absolute user data isolation. Authoritative user identity is extracted server-side strictly from verified Firebase ID tokens (`req.user.uid`). All queries and Firestore security rules strictly scope documents to `/users/{userId}/threads/{threadId}/interactions/{interactionId}` with `request.auth.uid == userId`.

### Zone 5: Inter-System Communication & Secrets
- **Threat**: Secret leakage in logs, frontend bundles, source control, or error traces.
- **Mitigation**: Zero secret exposure architecture. In production, `GEMINI_API_KEY` is provisioned exclusively through Google Cloud Secret Manager and mounted directly into the Cloud Run container runtime environment. No `VITE_` variables exist for secrets. Automatic regex scrubber (`redactSecrets`) strips key patterns from all server logs.

---

## 2. Google Cloud Secret Manager Architecture

### Runtime Secret Injection Model

```
+--------------------------+
| Google Cloud             |
| Secret Manager           |
| Secret:                  |
| gemini-thoughtvault-     |
| api-key                  |
+------------+-------------+
             |
             | Runtime Secret Injection (--set-secrets)
             v
+------------------------------------+
| Cloud Run Container Runtime        |
| (Identity: thoughtvault-runner SA) |
|                                    |
|  process.env.GEMINI_API_KEY        |
|                |                   |
|                v                   |
|       validateServerConfig()       |
|                v                   |
|       Gemini Fallback Service      |
+-----------------+------------------+
                  |
                  | HTTPS (Server-to-Server Only)
                  v
         +-----------------+
         | Google Gemini   |
         | AI API Endpoint |
         +-----------------+
```

1. **Authoritative Store**: Secret Manager holds the production API key under secret name: `gemini-thoughtvault-api-key`.
2. **Runtime Binding**: Cloud Run mounts this secret as an environment variable at startup using:
   `--set-secrets="GEMINI_API_KEY=gemini-thoughtvault-api-key:latest"`
3. **Container Isolation**: The key resides only within the Cloud Run container memory. It is never written to disk, never serialized in client responses, and never bundled into frontend assets.

---

## 3. Least-Privilege IAM Architecture

To adhere strictly to the principle of least privilege, Cloud Run must NOT execute using the default Compute Engine service account. Instead, configure a dedicated runtime service account:

### Dedicated Service Account
```bash
thoughtvault-runner@${PROJECT_ID}.iam.gserviceaccount.com
```

### Resource-Level Secret Access
Grant `roles/secretmanager.secretAccessor` **ONLY** on the specific secret, never project-wide:

```bash
gcloud secrets add-iam-policy-binding gemini-thoughtvault-api-key \
  --project="${PROJECT_ID}" \
  --member="serviceAccount:thoughtvault-runner@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

---

## 4. Secret Rotation Procedure

When rotating the Gemini API credential:

1. **Create New Version**: Add a new secret version in Secret Manager without destroying the old one:
   ```bash
   echo -n "NEW_API_KEY_HERE" | gcloud secrets versions add gemini-thoughtvault-api-key \
     --project="${PROJECT_ID}" \
     --data-file=-
   ```
2. **Gradual Rollout**: Cloud Run services configured with `:latest` will consume the new version on new instance starts or revision deployments.
3. **Verify Health**: Check the `/api/health` endpoint and test a journal reflection.
4. **Destroy Stale Version**: Once verified, disable and destroy the old version:
   ```bash
   gcloud secrets versions destroy <OLD_VERSION_NUMBER> \
     --secret=gemini-thoughtvault-api-key \
     --project="${PROJECT_ID}"
   ```

---

## 5. Security Verification & Pre-Deployment Checklist

- [x] Zero Gemini API keys in client-side code (searched entire `/src` directory).
- [x] No `VITE_GEMINI_API_KEY` exists in any configuration or template.
- [x] All server logs are scrubbed with `redactSecrets()` to prevent accidental token or key printing.
- [x] Uncaught server error handlers return generic messages without stack traces.
- [x] Secret Manager secret `gemini-thoughtvault-api-key` is documented and isolated to dedicated service account.
- [x] Firestore security rules enforce `request.auth.uid == userId` for all read and write operations.
