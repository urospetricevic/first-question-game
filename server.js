const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = __dirname;
loadEnvFile(path.join(root, ".env"));

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const maxAttempts = 7;
const dataDir = process.env.DATA_DIR || path.join(root, "data");
const answersPath = path.join(dataDir, "answers.json");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readStore() {
  try {
    const store = JSON.parse(fs.readFileSync(answersPath, "utf8"));
    return {
      participants: store.participants || [],
      attempts: store.attempts || [],
    };
  } catch {
    return { participants: [], attempts: [] };
  }
}

function writeStore(store) {
  fs.mkdirSync(path.dirname(answersPath), { recursive: true });
  fs.writeFileSync(answersPath, JSON.stringify(store, null, 2));
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

function hashIp(ip) {
  return crypto.createHash("sha256").update(`first-question:${ip}`).digest("hex");
}

function getParticipantState(store, email, ipHash) {
  const matching = store.attempts.filter((attempt) => attempt.email === email || attempt.ipHash === ipHash);
  const passed = matching.some((attempt) => attempt.pass);
  return {
    passed,
    attempts: matching.length,
    remaining: Math.max(0, maxAttempts - matching.length),
  };
}

function getRegisteredParticipant(store, ipHash) {
  return store.participants.find((participant) => participant.ipHash === ipHash);
}

function registerParticipant(store, email, ipHash) {
  const existing = getRegisteredParticipant(store, ipHash);
  if (existing && existing.email !== email) {
    return {
      ok: false,
      message: "This IP already registered a different email.",
      email: existing.email,
    };
  }

  if (!existing) {
    store.participants.push({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      email,
      ipHash,
    });
    writeStore(store);
  }

  return { ok: true, email };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20_000) {
        reject(new Error("Answer is too long."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function localRuleJudge(answer) {
  const normalized = answer.trim().toLowerCase();
  const startsYes = /^yes\b/.test(normalized);
  const startsNo = /^no\b/.test(normalized);
  const ambiguous = /\b(neither|both|depends|maybe|not sure|cannot say|can't say)\b/.test(normalized);
  const hasReason = /\b(because|since|as|for|when|if|although|but)\b/.test(normalized) && answer.trim().split(/\s+/).length >= 8;
  const pass = (startsYes !== startsNo) && !ambiguous && hasReason;

  return {
    pass,
    stance: startsYes ? "yes" : startsNo ? "no" : ambiguous ? "neither" : "unclear",
    message: pass
      ? "The answer chooses a side and gives a reason. The gate opens."
      : "The answer must begin with yes or no and include an explanation. Neither, both, maybe, or silence will not pass.",
    mode: "local fallback",
  };
}

async function llmJudge(answer) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return localRuleJudge(answer);
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      pass: { type: "boolean" },
      stance: { type: "string", enum: ["yes", "no", "neither", "unclear"] },
      message: { type: "string" },
    },
    required: ["pass", "stance", "message"],
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "You are the Level 1 gate judge for a minimalist game. The player is asked: 'Are you humans good?' To pass, the answer must take exactly one clear stance: yes or no. It must not answer neither, both, maybe, it depends, unclear, or avoid the question. It must include a meaningful explanation. Be strict but concise.",
        },
        {
          role: "user",
          content: `Evaluate this answer for Level 1:\n\n${answer}`,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "level_one_verdict",
          schema,
          strict: true,
        },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM judge failed: ${response.status} ${text.slice(0, 240)}`);
  }

  const data = await response.json();
  const output = data.output_text || data.output?.flatMap((item) => item.content || []).find((part) => part.type === "output_text")?.text;
  const verdict = JSON.parse(output);
  return { ...verdict, mode: `LLM judge (${model})` };
}

async function handleEvaluate(req, res) {
  try {
    const body = await readBody(req);
    const parsed = JSON.parse(body || "{}");
    const email = normalizeEmail(parsed.email);
    const answer = String(parsed.answer || "").trim();
    const ipHash = hashIp(getClientIp(req));
    const store = readStore();

    if (!isValidEmail(email)) {
      return sendJson(res, 400, {
        pass: false,
        blocked: false,
        stance: "unclear",
        message: "Email is required.",
        remaining: maxAttempts,
      });
    }

    const registered = getRegisteredParticipant(store, ipHash);
    if (!registered || registered.email !== email) {
      return sendJson(res, 403, {
        pass: false,
        blocked: true,
        stance: "blocked",
        message: "Register email first.",
        remaining: 0,
      });
    }

    if (!answer) {
      return sendJson(res, 400, {
        pass: false,
        blocked: false,
        stance: "unclear",
        message: "The question waits. Empty silence is not an answer.",
        remaining: getParticipantState(store, email, ipHash).remaining,
      });
    }

    const participant = getParticipantState(store, email, ipHash);
    if (participant.passed) {
      return sendJson(res, 200, {
        pass: true,
        blocked: false,
        stance: "accepted",
        message: "Already accepted.",
        remaining: participant.remaining,
      });
    }

    if (participant.attempts >= maxAttempts) {
      return sendJson(res, 429, {
        pass: false,
        blocked: true,
        stance: "blocked",
        message: "No chances remain.",
        remaining: 0,
      });
    }

    const verdict = await llmJudge(answer.slice(0, 900));
    const savedAttempt = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      email,
      ipHash,
      answer: answer.slice(0, 900),
      pass: Boolean(verdict.pass),
      stance: verdict.stance,
      mode: verdict.mode || "unknown",
    };
    store.attempts.push(savedAttempt);
    writeStore(store);

    const nextState = getParticipantState(store, email, ipHash);
    return sendJson(res, 200, {
      ...verdict,
      blocked: !verdict.pass && nextState.remaining === 0,
      remaining: nextState.remaining,
    });
  } catch (error) {
    return sendJson(res, 500, {
      pass: false,
      blocked: false,
      stance: "unclear",
      message: error.message || "The judge failed.",
    });
  }
}

async function handleStart(req, res) {
  try {
    const body = await readBody(req);
    const parsed = JSON.parse(body || "{}");
    const email = normalizeEmail(parsed.email);
    const ipHash = hashIp(getClientIp(req));

    if (!isValidEmail(email)) {
      return sendJson(res, 400, {
        ok: false,
        message: "Email is required.",
      });
    }

    const store = readStore();
    const registration = registerParticipant(store, email, ipHash);
    if (!registration.ok) {
      return sendJson(res, 403, registration);
    }

    const participant = getParticipantState(store, email, ipHash);
    if (!participant.passed && participant.remaining === 0) {
      return sendJson(res, 429, {
        ok: false,
        email,
        blocked: true,
        passed: false,
        remaining: 0,
        message: "No chances remain.",
      });
    }

    return sendJson(res, 200, {
      ok: true,
      email,
      blocked: false,
      passed: participant.passed,
      remaining: participant.remaining,
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      message: error.message || "Could not start.",
    });
  }
}

function handleStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(root, requested));

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/start") {
    handleStart(req, res);
    return;
  }
  if (req.method === "POST" && req.url === "/api/evaluate") {
    handleEvaluate(req, res);
    return;
  }
  if (req.method === "GET") {
    handleStatic(req, res);
    return;
  }
  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(port, host, () => {
  console.log(`The First Question is running on http://127.0.0.1:${port}`);
  console.log(process.env.OPENAI_API_KEY ? `Using ${model} for judging.` : "OPENAI_API_KEY not set; using local fallback judge.");
});
