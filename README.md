# The First Question

A small server-backed browser game. Level 1 asks:

> Are you humans good?

Players must register one email per IP, then answer with a clear yes/no plus an explanation. Answers are judged by an OpenAI model when `OPENAI_API_KEY` is configured.

## Local Run

```bash
npm start
```

Open `http://127.0.0.1:4173`.

Create `.env` locally:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4.1-mini
```

## Deploy On Render

This app saves attempts and email/IP locks on disk. The included default Render config uses a free web service, which is fine for sharing a prototype, but its local saved data can reset when the service restarts or redeploys.

The included `render.yaml` configures:

- Node web service
- `npm start`
- `DATA_DIR=/tmp/first-question-data`
- `OPENAI_API_KEY` as a secret to set in Render

After creating the service, add your `OPENAI_API_KEY` in Render's Environment settings.

For permanent saved answers, upgrade the service and add a persistent disk, then set `DATA_DIR` to the disk mount path.

## Deploy On GCP

Use Cloud Run for the web app and Cloud SQL for Postgres. When Cloud SQL env vars are present, the app stores participants and attempts in Postgres. Without them, local development still uses `data/answers.json`.

One-time setup:

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com

gcloud sql instances create first-question-db \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region=us-central1

gcloud sql databases create first_question --instance=first-question-db
gcloud sql users create first_question_user --instance=first-question-db --password='REPLACE_WITH_STRONG_PASSWORD'

printf 'REPLACE_WITH_STRONG_PASSWORD' | gcloud secrets create first-question-db-password --data-file=-
printf 'YOUR_OPENAI_API_KEY' | gcloud secrets create first-question-openai-api-key --data-file=-
```

Deploy:

```bash
PROJECT_ID="$(gcloud config get-value project)"
INSTANCE_CONNECTION_NAME="$PROJECT_ID:us-central1:first-question-db"

gcloud run deploy first-question-game \
  --source . \
  --region=us-central1 \
  --allow-unauthenticated \
  --add-cloudsql-instances="$INSTANCE_CONNECTION_NAME" \
  --set-env-vars="INSTANCE_CONNECTION_NAME=$INSTANCE_CONNECTION_NAME,DB_NAME=first_question,DB_USER=first_question_user,OPENAI_MODEL=gpt-4.1-mini" \
  --set-secrets="DB_PASSWORD=first-question-db-password:latest,OPENAI_API_KEY=first-question-openai-api-key:latest"
```

Inspect saved answers:

```bash
gcloud sql connect first-question-db --user=first_question_user --database=first_question
```

Then in `psql`:

```sql
select email, answer, pass, stance, mode, created_at
from attempts
order by created_at desc;
```
