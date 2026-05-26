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

This app saves attempts and email/IP locks on disk, so use a Render web service with a persistent disk.

The included `render.yaml` configures:

- Node web service
- `npm start`
- `DATA_DIR=/var/data`
- 1 GB persistent disk mounted at `/var/data`
- `OPENAI_API_KEY` as a secret to set in Render

After creating the service, add your `OPENAI_API_KEY` in Render's Environment settings.
