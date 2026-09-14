# Deployment Guide: Google Cloud Run & Secret Manager

This guide provides end-to-end instructions for deploying **Gemini ThoughtVault** to Google Cloud Run with Google Cloud Secret Manager runtime secret injection and strict IAM isolation.

---

## Prerequisites

- [Google Cloud SDK (`gcloud`)](https://cloud.google.com/sdk/docs/install) installed and authenticated.
- A Google Cloud project with billing enabled.
- Firebase project configured with Google Sign-In and Cloud Firestore.

---

## 1. Set Environment Variables

```bash
export PROJECT_ID="your-gcp-project-id"
export REGION="asia-southeast1" # Or us-central1, etc.
export SERVICE_NAME="gemini-thoughtvault"
export SA_NAME="thoughtvault-runner"
export SECRET_NAME="gemini-thoughtvault-api-key"

gcloud config set project "${PROJECT_ID}"
```

---

## 2. Enable Required Google Cloud APIs

```bash
gcloud services enable \
  run.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  firestore.googleapis.com \
  cloudbuild.googleapis.com \
  --project="${PROJECT_ID}"
```

---

## 3. Provision Secret Manager Secret

Create the secret container and populate it with your Gemini API key:

```bash
# 1. Create the secret container
gcloud secrets create "${SECRET_NAME}" \
  --replication-policy="automatic" \
  --project="${PROJECT_ID}"

# 2. Add the API key value (pipe securely via stdin to avoid shell history logging)
echo -n "YOUR_ACTUAL_GEMINI_API_KEY" | gcloud secrets versions add "${SECRET_NAME}" \
  --data-file=- \
  --project="${PROJECT_ID}"
```

---

## 4. Configure Dedicated Cloud Run Service Account (Least Privilege)

Create a custom service account for Cloud Run:

```bash
# 1. Create dedicated service account
gcloud iam service-accounts create "${SA_NAME}" \
  --display-name="ThoughtVault Cloud Run Runner" \
  --project="${PROJECT_ID}"

# 2. Grant Secret Accessor ONLY to the specific secret (Resource-level binding, NOT project-wide admin)
gcloud secrets add-iam-policy-binding "${SECRET_NAME}" \
  --member="serviceAccount:${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project="${PROJECT_ID}"

# 3. Grant Firestore User role for server-side Firebase Admin SDK operations
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/datastore.user"
```

> **Least-Privilege Principle**: The service account strictly requires only `roles/secretmanager.secretAccessor` (scoped specifically to the `gemini-thoughtvault-api-key` secret) and `roles/datastore.user`. It does **NOT** require `Owner`, `Editor`, `Secret Manager Admin`, or broad administrative roles.
> 
> **Server-Side vs. Client-Side Firestore Security**:
> - Client/Browser Firestore queries are strictly restricted by `firestore.rules` requiring `request.auth.uid == userId`.
> - Server-side Firebase Admin SDK access from Cloud Run bypasses client security rules and is governed exclusively by the Cloud Run runtime service account's IAM permissions (`roles/datastore.user`). Firestore Security Rules alone do not constrain server-side Admin SDK operations.

---

## 5. Build and Deploy to Cloud Run

Deploy the container using Cloud Run, attaching the secret, bounding resources, and including the required challenge label:

```bash
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

### Deployment Configuration Parameters
- `--platform="managed"`: Fully managed serverless container runtime.
- `--allow-unauthenticated` & `--ingress="all"`: Permits public HTTP ingress so that browser clients can access the React SPA and API gateway. **Application security is enforced at the route level via Firebase ID token cryptographic verification**, not network blocking.
- `--set-secrets="GEMINI_API_KEY=${SECRET_NAME}:latest"`: Safely mounts the key into the server environment directly from Secret Manager at container boot.
- `--set-labels="dev-tutorial=cloud-run-ai-challenge"`: Official challenge verification label.
- `--cpu=1` & `--memory=512Mi`: Sized efficiently for Node.js Express + AI orchestration.
- `--concurrency=80` & `--timeout=60s`: Handles up to 80 concurrent connections per container instance with a 60-second execution timeout.
- `--max-instances=10` & `--min-instances=0`: Protects against runaway autoscaling and unexpected billing costs while scaling to zero when idle.
- *Note*: These resource and scaling limits provide operational boundaries rather than absolute cost ceilings. In-memory sliding-window rate limiters operate per Cloud Run container instance.

---

## 6. Post-Deployment Verification

### 1. Test Service Health
```bash
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" --platform=managed --region="${REGION}" --format="value(status.url)")

# Cloud Run health checks support both root and API endpoints (fast, unauthenticated, zero DB/AI overhead):
curl -i "${SERVICE_URL}/health"
curl -i "${SERVICE_URL}/api/health"
```
Expected response:
```json
{"status":"ok","service":"gemini-thoughtvault","timestamp":"..."}
```

### 2. Verify Security Headers
```bash
curl -I "${SERVICE_URL}/health"
```
Verify the presence of:
- `Content-Security-Policy` (scoped to self, Firebase Auth, and Google Sign-In)
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` (in production)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

### 3. Verify Secret Injection & Logs
Review Cloud Run logs to ensure `GEMINI_API_KEY` was successfully detected without any secret values printed:
```bash
gcloud beta run services logs tail "${SERVICE_NAME}" --project="${PROJECT_ID}"
```
You should see:
`[CONFIG] Server runtime secrets verified. Gemini API key is securely present (Secret Manager / Runtime Injection).`

### 4. Container Lifecycle & Graceful Shutdown
The service intercepts `SIGTERM` and `SIGINT` signals sent by Cloud Run during autoscaling scale-down and container rollout events. The HTTP server drains active connections with a 10-second bounded grace window before process termination, preventing dropped in-flight journal reflections or insights.

---

## 7. Cloud Run Revision Safety & Rollback

Every deployment or configuration change in Cloud Run creates an immutable, numbered **Revision**:
- Updating container images, environment variables, Secret Manager bindings, or resource limits automatically spins up a new revision.
- If a newly deployed revision encounters an issue, you can immediately roll back traffic to the previous known-good revision with zero downtime:

```bash
# List revisions to find the previous stable revision name
gcloud run revisions list --service="${SERVICE_NAME}" --region="${REGION}"

# Instant zero-downtime rollback to previous stable revision:
gcloud run services update-traffic "${SERVICE_NAME}" \
  --region="${REGION}" \
  --to-revisions="PREVIOUS_REVISION_NAME=100"
```

---

## 8. Safe Secret Rotation Workflow

When rotating the Gemini API key, execute this zero-downtime rotation procedure:

1. **Add New Secret Version to Secret Manager**:
   ```bash
   echo -n "NEW_GEMINI_API_KEY" | gcloud secrets versions add "${SECRET_NAME}" \
     --data-file=- \
     --project="${PROJECT_ID}"
   ```
2. **Keep Secret Name Stable**:
   The secret container name remains `gemini-thoughtvault-api-key`. Do not create a new secret entity.
3. **Deploy New Cloud Run Revision**:
   Deploying or redeploying automatically creates a new revision referencing the latest secret version:
   ```bash
   gcloud run deploy "${SERVICE_NAME}" \
     --image="gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest" \
     --region="${REGION}" \
     --set-secrets="GEMINI_API_KEY=${SECRET_NAME}:latest"
   ```
4. **Verify New Revision**:
   Execute health and journal tests on the newly provisioned revision before shifting production traffic.
5. **Gradual Traffic Shift (Canary Deployment)**:
   ```bash
   gcloud run services update-traffic "${SERVICE_NAME}" \
     --region="${REGION}" \
     --to-revisions="NEW_REVISION_NAME=10,OLD_REVISION_NAME=90"
   ```
6. **Decommission Obsolete Secret Versions**:
   Once all traffic is successfully handled by the new revision and old instances have drained, disable or destroy the old secret version in Secret Manager:
   ```bash
   gcloud secrets versions destroy VERSION_NUMBER --secret="${SECRET_NAME}" --project="${PROJECT_ID}"
   ```
