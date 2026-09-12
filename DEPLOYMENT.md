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
# 1. Create service account
gcloud iam service-accounts create "${SA_NAME}" \
  --display-name="ThoughtVault Cloud Run Runner" \
  --project="${PROJECT_ID}"

# 2. Grant Secret Accessor ONLY to the specific secret (Resource-level binding)
gcloud secrets add-iam-policy-binding "${SECRET_NAME}" \
  --member="serviceAccount:${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project="${PROJECT_ID}"

# 3. Grant Firestore User role for database reads/writes
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/datastore.user"
```

---

## 5. Build and Deploy to Cloud Run

Deploy the container using Cloud Run build packs or container image, attaching the secret and the required challenge label:

```bash
gcloud run deploy "${SERVICE_NAME}" \
  --source="." \
  --region="${REGION}" \
  --platform="managed" \
  --service-account="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --set-secrets="GEMINI_API_KEY=${SECRET_NAME}:latest" \
  --set-labels="dev-tutorial=cloud-run-ai-challenge" \
  --allow-unauthenticated \
  --port=3000 \
  --memory=512Mi \
  --cpu=1
```

> **Notice**: The `--set-secrets="GEMINI_API_KEY=${SECRET_NAME}:latest"` parameter safely mounts the key directly into the container runtime environment without ever exposing it in command arguments, environment files, or client builds.
> The `--set-labels="dev-tutorial=cloud-run-ai-challenge"` verifies the official challenge criteria.

---

## 6. Post-Deployment Verification

### 1. Test Service Health
```bash
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" --platform=managed --region="${REGION}" --format="value(status.url)")
curl -i "${SERVICE_URL}/api/health"
```
Expected response:
```json
{"status":"ok","service":"gemini-thoughtvault","timestamp":"..."}
```

### 2. Verify Secret Injection & Logs
Review Cloud Run logs to ensure `GEMINI_API_KEY` was successfully detected without any secret values printed:
```bash
gcloud beta run services logs tail "${SERVICE_NAME}" --project="${PROJECT_ID}"
```
You should see:
`[CONFIG] Server runtime secrets verified. Gemini API key is securely present (Secret Manager / Runtime Injection).`
