const emailForm = document.getElementById("emailForm");
const form = document.getElementById("answerForm");
const email = document.getElementById("email");
const answer = document.getElementById("answer");
const result = document.getElementById("result");
const gateResult = document.getElementById("gateResult");
const button = document.getElementById("enterButton");
const emailButton = document.getElementById("emailButton");
const emailGate = document.getElementById("emailGate");
const levelOne = document.getElementById("levelOne");
const questionBlock = levelOne.querySelector(".question-block");

let activeEmail = "";

function showResult(payload) {
  result.className = `result ${payload.pass ? "pass" : "fail"}`;
  if (payload.pass) {
    showLevelTwoInvite();
    return;
  }

  if (payload.blocked) {
    result.innerHTML = '<span class="verdict">Blocked</span>';
    return;
  }

  const remaining = Number.isFinite(payload.remaining) ? `<span class="detail">${payload.remaining} chances remain.</span>` : "";
  result.innerHTML = `<span class="verdict">Rejected</span>${remaining}`;
}

function showGateResult(payload) {
  gateResult.className = `result ${payload.ok ? "pass" : "fail"}`;
  gateResult.innerHTML = `<span class="verdict">${payload.ok ? "Accepted" : "Blocked"}</span>`;
}

function showGateError(message) {
  gateResult.className = "result fail";
  gateResult.innerHTML = `<span class="verdict">${message}</span>`;
}

function showLevelTwoInvite() {
  questionBlock.hidden = true;
  form.hidden = true;
  result.className = "result pass";
  result.innerHTML = '<span class="verdict">Accepted</span><span class="detail">You will be invited to Level 2.</span>';
}

function showLevel(emailValue) {
  activeEmail = emailValue;
  emailGate.hidden = true;
  levelOne.hidden = false;
  if (!form.hidden) {
    answer.focus();
  }
}

async function submitAnswer(event) {
  event.preventDefault();
  const text = answer.value.trim();

  if (!text) {
    showResult({
      pass: false,
      message: "The question waits. Empty silence is not an answer.",
      stance: "none",
    });
    return;
  }

  button.disabled = true;
  button.textContent = "...";
  result.className = "result";
  result.textContent = "...";

  try {
    const response = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: activeEmail, answer: text }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || "The judge did not answer.");
    }
    showResult(payload);
  } catch (error) {
    showResult({
      pass: false,
      message: error.message,
      stance: "unknown",
      mode: "judge offline",
    });
  } finally {
    button.disabled = false;
    button.textContent = "Enter";
  }
}

async function submitEmail(event) {
  event.preventDefault();
  const emailValue = email.value.trim();

  if (location.protocol === "file:") {
    showGateError("Open the server URL");
    return;
  }

  emailButton.disabled = true;
  emailButton.textContent = "...";
  gateResult.className = "result";
  gateResult.textContent = "...";

  try {
    const response = await fetch("/api/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailValue }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok || payload.blocked) {
      throw new Error(payload.message || "Blocked.");
    }
    sessionStorage.setItem("firstQuestionEmail", emailValue);
    showGateResult(payload);
    showLevel(emailValue);
    if (payload.passed) {
      showLevelTwoInvite();
    }
  } catch (error) {
    showGateError(error.message === "Failed to fetch" ? "Open the server URL" : "Blocked");
  } finally {
    emailButton.disabled = false;
    emailButton.textContent = "Enter";
  }
}

form.addEventListener("submit", submitAnswer);
emailForm.addEventListener("submit", submitEmail);

const savedEmail = sessionStorage.getItem("firstQuestionEmail");
if (savedEmail && location.protocol.startsWith("http")) {
  email.value = savedEmail;
  submitEmail(new Event("submit"));
}

if (location.protocol === "file:") {
  showGateError("Open the server URL");
}
