const VALID_LOGIN_ID = "lakshya srivastav";
const VALID_LOGIN_PASSWORD = "finnexus@2026";
const INACTIVITY_MS = 48 * 24 * 60 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 30 * 1000;

const STORAGE_KEYS = {
  lastLoginAt: "lfs.lastLoginAt",
  bankConnected: "lfs.bankConnected",
  fdConnected: "lfs.fdConnected",
  settings: "lfs.settings",
  inactivityTriggered: "lfs.inactivityTriggered"
};

const defaultSettings = {
  recipientName: "Guy",
  recipientEmail: "guy@example.com",
  assetList:
    "Savings Account - INR 2,50,000\nFD Holdings - INR 4,00,000\nMutual Funds - INR 3,25,000\nStocks - INR 1,80,000",
  customMessage:
    "If you receive this mail, I have been inactive for 48 days. Please use this summary for emergency handling.",
  emailTemplate:
    "Hello {{recipientName}},\n\nThis is an automated inactivity alert from FinNexus.\n\nAsset summary:\n{{assetList}}\n\nPersonal note:\n{{customMessage}}\n\nRegards,\nLakshya Srivastav"
};

const quizQuestions = [
  {
    id: "q1",
    text: "How stable is your primary monthly income?",
    category: "stability",
    weight: 1.3
  },
  {
    id: "q2",
    text: "What best describes your monthly income range?",
    category: "income",
    weight: 1.1,
    labels: [
      "Below INR 30,000",
      "INR 30,000 to INR 60,000",
      "INR 60,000 to INR 1,00,000",
      "INR 1,00,000 to INR 2,00,000",
      "Above INR 2,00,000"
    ]
  },
  {
    id: "q3",
    text: "I usually pay bills and dues on time.",
    category: "discipline",
    weight: 1.0
  },
  {
    id: "q4",
    text: "A large part of my income is consumed by debt repayment.",
    category: "debt",
    weight: 1.3,
    invert: true
  },
  {
    id: "q5",
    text: "My emergency fund can cover at least 3 months of expenses.",
    category: "safety",
    weight: 1.3
  },
  {
    id: "q6",
    text: "I track spending weekly and review trends.",
    category: "discipline",
    weight: 1.1
  },
  {
    id: "q7",
    text: "Impulse purchases are under control.",
    category: "discipline",
    weight: 1.2
  },
  {
    id: "q8",
    text: "I have adequate health/life insurance in place.",
    category: "safety",
    weight: 1.0
  },
  {
    id: "q9",
    text: "I save money every month before discretionary spending.",
    category: "savings",
    weight: 1.3
  },
  {
    id: "q10",
    text: "I invest regularly (SIP, stocks, or other assets).",
    category: "investment",
    weight: 1.2
  },
  {
    id: "q11",
    text: "I have clear financial goals for the next 1-3 years.",
    category: "planning",
    weight: 1.1
  },
  {
    id: "q12",
    text: "I know exactly where my money leaks every month.",
    category: "discipline",
    weight: 1.0
  },
  {
    id: "q13",
    text: "I can absorb a sudden INR 25,000 expense without stress.",
    category: "safety",
    weight: 1.2
  },
  {
    id: "q14",
    text: "I use credit cards strategically and repay in full.",
    category: "debt",
    weight: 1.1
  },
  {
    id: "q15",
    text: "My lifestyle spending generally stays within planned limits.",
    category: "discipline",
    weight: 1.1
  },
  {
    id: "q16",
    text: "I maintain low-risk reserves (FD/liquid fund) for near-term goals.",
    category: "savings",
    weight: 1.0
  },
  {
    id: "q17",
    text: "My retirement planning is active and improving yearly.",
    category: "planning",
    weight: 1.0
  },
  {
    id: "q18",
    text: "I handle taxes proactively to avoid last-minute surprises.",
    category: "planning",
    weight: 0.9
  },
  {
    id: "q19",
    text: "I am confident in my financial literacy and decisions.",
    category: "investment",
    weight: 0.9
  },
  {
    id: "q20",
    text: "I am comfortable automating transfers for savings/investments.",
    category: "automation",
    weight: 1.1
  }
];

const defaultScaleLabels = ["Very low", "Low", "Moderate", "High", "Very high"];

const loginView = document.getElementById("loginView");
const dashboardView = document.getElementById("dashboardView");
const loginForm = document.getElementById("loginForm");
const loginIdInput = document.getElementById("loginId");
const loginPasswordInput = document.getElementById("loginPassword");
const loginError = document.getElementById("loginError");
const securityStatus = document.getElementById("securityStatus");
const quizForm = document.getElementById("quizForm");
const analyzeBtn = document.getElementById("analyzeBtn");
const budgetOutput = document.getElementById("budgetOutput");
const automationList = document.getElementById("automationList");
const scoreText = document.getElementById("scoreText");
const integrationStatus = document.getElementById("integrationStatus");
const connectBankBtn = document.getElementById("connectBankBtn");
const connectFdBtn = document.getElementById("connectFdBtn");
const settingsPanel = document.getElementById("settingsPanel");
const profileButton = document.getElementById("profileButton");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");
const settingsForm = document.getElementById("settingsForm");
const countdownEl = document.getElementById("countdown");
const previewEmailBtn = document.getElementById("previewEmailBtn");
const simulateBtn = document.getElementById("simulateBtn");
const emailPreview = document.getElementById("emailPreview");
const mailtoLink = document.getElementById("mailtoLink");
const toast = document.getElementById("toast");

let timerId = null;
let saveSettingsDebounceId = null;
let failedLoginAttempts = 0;
let lockoutUntil = 0;

renderQuiz();
hydrateSettings();
refreshConnectionStatus();
showLoginOnly();
ensureLastLoginExists();
startCountdown();
setSecurityStatus("Protected session ready.");

loginIdInput.addEventListener("input", clearLoginFeedback);
loginPasswordInput.addEventListener("input", clearLoginFeedback);

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const now = Date.now();
  if (now < lockoutUntil) {
    const seconds = Math.ceil((lockoutUntil - now) / 1000);
    loginError.textContent = `Access paused. Retry in ${seconds}s.`;
    setSecurityStatus("Temporary lock is active.");
    return;
  }

  const entered = loginIdInput.value.trim().toLowerCase();
  const enteredPassword = loginPasswordInput.value;

  if (entered !== VALID_LOGIN_ID || enteredPassword !== VALID_LOGIN_PASSWORD) {
    failedLoginAttempts += 1;
    const attemptsLeft = MAX_LOGIN_ATTEMPTS - failedLoginAttempts;

    if (attemptsLeft <= 0) {
      lockoutUntil = now + LOGIN_LOCK_MS;
      failedLoginAttempts = 0;
      loginError.textContent = "Too many failed attempts. Account locked for 30s.";
      setSecurityStatus("Security lock enabled for 30 seconds.");
      return;
    }

    loginError.textContent = `Invalid ID or password. Attempts left: ${attemptsLeft}.`;
    setSecurityStatus("Credential verification failed.");
    return;
  }

  failedLoginAttempts = 0;
  lockoutUntil = 0;
  loginError.textContent = "";
  setSecurityStatus("Identity verified. Secure channel established.");
  localStorage.setItem(STORAGE_KEYS.lastLoginAt, String(Date.now()));
  localStorage.setItem(STORAGE_KEYS.inactivityTriggered, "false");
  loginPasswordInput.value = "";
  showDashboard();
  startCountdown();
  showToast("Login successful. FinNexus console unlocked.");
});

analyzeBtn.addEventListener("click", () => {
  const answers = collectAnswers();
  if (!answers) {
    showToast("Please complete all 20 questions before analysis.");
    return;
  }

  const analysis = analyzeFinancialCondition(answers);
  renderBudgetPlan(analysis.allocation, analysis.estimatedIncome);
  renderAutomation(analysis);

  scoreText.textContent = `Financial score: ${analysis.score}/100 | Profile: ${analysis.profile}`;
  showToast("Analysis complete. Automation plan generated.");
});

connectBankBtn.addEventListener("click", () => {
  localStorage.setItem(STORAGE_KEYS.bankConnected, "true");
  refreshConnectionStatus();
  showToast("Bank account connected (simulation). Data channel active.");
});

connectFdBtn.addEventListener("click", () => {
  localStorage.setItem(STORAGE_KEYS.fdConnected, "true");
  refreshConnectionStatus();
  showToast("FD channel connected (simulation). Reserve tracking enabled.");
});

profileButton.addEventListener("click", () => {
  settingsPanel.classList.add("open");
  settingsPanel.setAttribute("aria-hidden", "false");
});

closeSettingsBtn.addEventListener("click", () => {
  settingsPanel.classList.remove("open");
  settingsPanel.setAttribute("aria-hidden", "true");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    settingsPanel.classList.remove("open");
    settingsPanel.setAttribute("aria-hidden", "true");
  }
});

settingsForm.addEventListener("input", () => {
  window.clearTimeout(saveSettingsDebounceId);
  saveSettingsDebounceId = window.setTimeout(() => {
    persistSettings();
  }, 200);
});

previewEmailBtn.addEventListener("click", () => {
  persistSettings();
  const preview = buildEmailPreview();
  emailPreview.textContent = preview;
  enableMailto(preview);
  showToast("Email preview updated.");
});

simulateBtn.addEventListener("click", () => {
  const simulatedTime = Date.now() - INACTIVITY_MS - 60 * 1000;
  localStorage.setItem(STORAGE_KEYS.lastLoginAt, String(simulatedTime));
  localStorage.setItem(STORAGE_KEYS.inactivityTriggered, "false");
  updateCountdown();
  triggerInactivityDispatch(true);
});

function renderQuiz() {
  quizForm.innerHTML = "";

  quizQuestions.forEach((question, index) => {
    const block = document.createElement("div");
    block.className = "question";

    const prompt = document.createElement("p");
    prompt.textContent = `${index + 1}. ${question.text}`;

    const select = document.createElement("select");
    select.name = question.id;
    select.required = true;

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select your answer";
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);

    const labels = question.labels || defaultScaleLabels;

    labels.forEach((label, idx) => {
      const option = document.createElement("option");
      option.value = String(idx + 1);
      option.textContent = `${idx + 1} - ${label}`;
      select.appendChild(option);
    });

    block.appendChild(prompt);
    block.appendChild(select);
    quizForm.appendChild(block);
  });
}

function collectAnswers() {
  const answers = {};

  for (const question of quizQuestions) {
    const field = quizForm.elements.namedItem(question.id);
    const value = field ? Number(field.value) : NaN;

    if (!Number.isFinite(value) || value < 1 || value > 5) {
      return null;
    }

    answers[question.id] = value;
  }

  return answers;
}

function analyzeFinancialCondition(answers) {
  let weightedScore = 0;
  let weightedMax = 0;
  const categoryTrack = {};

  quizQuestions.forEach((question) => {
    const raw = answers[question.id];
    const normalized = question.invert ? 6 - raw : raw;

    weightedScore += normalized * question.weight;
    weightedMax += 5 * question.weight;

    if (!categoryTrack[question.category]) {
      categoryTrack[question.category] = { total: 0, count: 0 };
    }

    categoryTrack[question.category].total += normalized;
    categoryTrack[question.category].count += 1;
  });

  const score = Math.round((weightedScore / weightedMax) * 100);
  const profile = getProfileName(score);
  const estimatedIncome = estimateMonthlyIncome(answers.q2);
  const allocation = buildAllocation(score, answers);

  return {
    score,
    profile,
    estimatedIncome,
    allocation,
    categoryTrack
  };
}

function getProfileName(score) {
  if (score < 45) {
    return "Defensive Reset";
  }
  if (score < 70) {
    return "Stability Builder";
  }
  return "Growth Optimizer";
}

function estimateMonthlyIncome(incomeAnswer) {
  const incomeMap = {
    1: 30000,
    2: 60000,
    3: 100000,
    4: 160000,
    5: 250000
  };

  return incomeMap[incomeAnswer] || 60000;
}

function buildAllocation(score, answers) {
  let allocation;

  if (score < 45) {
    allocation = {
      essentials: 50,
      debt: 24,
      savings: 14,
      investments: 4,
      lifestyle: 8
    };
  } else if (score < 70) {
    allocation = {
      essentials: 47,
      debt: 16,
      savings: 20,
      investments: 9,
      lifestyle: 8
    };
  } else {
    allocation = {
      essentials: 44,
      debt: 10,
      savings: 21,
      investments: 17,
      lifestyle: 8
    };
  }

  const debtPressure = 6 - answers.q4;
  const automationReadiness = answers.q20;

  if (debtPressure >= 4) {
    allocation.debt += 6;
    allocation.investments -= 3;
    allocation.lifestyle -= 2;
    allocation.savings -= 1;
  }

  if (automationReadiness >= 4) {
    allocation.savings += 2;
    allocation.investments += 1;
    allocation.lifestyle -= 2;
    allocation.essentials -= 1;
  }

  return normalizeAllocation(allocation);
}

function normalizeAllocation(allocation) {
  const entries = Object.entries(allocation).map(([key, value]) => [key, Math.max(2, value)]);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);

  const normalized = {};
  entries.forEach(([key, value]) => {
    normalized[key] = Math.round((value / total) * 100);
  });

  const finalTotal = Object.values(normalized).reduce((sum, value) => sum + value, 0);
  const diff = 100 - finalTotal;
  normalized.essentials += diff;

  return normalized;
}

function renderBudgetPlan(allocation, estimatedIncome) {
  budgetOutput.classList.remove("empty-state");
  budgetOutput.innerHTML = "";

  const labels = {
    essentials: "Essentials",
    debt: "Debt Paydown",
    savings: "Savings",
    investments: "Investments",
    lifestyle: "Lifestyle"
  };

  Object.keys(allocation).forEach((key) => {
    const percent = allocation[key];
    const amount = Math.round((percent / 100) * estimatedIncome);

    const row = document.createElement("div");
    row.className = "bar-row";

    row.innerHTML = `
      <header>
        <span>${labels[key]}</span>
        <span>${percent}% | INR ${formatCurrency(amount)}</span>
      </header>
      <div class="bar-track">
        <div class="bar-fill" style="width: 0%"></div>
      </div>
    `;

    budgetOutput.appendChild(row);

    const fill = row.querySelector(".bar-fill");
    window.requestAnimationFrame(() => {
      fill.style.width = `${percent}%`;
    });
  });
}

function renderAutomation(analysis) {
  const actions = [];
  const allocation = analysis.allocation;
  const monthlyIncome = analysis.estimatedIncome;
  const bankConnected = localStorage.getItem(STORAGE_KEYS.bankConnected) === "true";
  const fdConnected = localStorage.getItem(STORAGE_KEYS.fdConnected) === "true";

  actions.push(
    `Auto-transfer INR ${formatCurrency(Math.round((allocation.savings / 100) * monthlyIncome))} to savings every salary day.`
  );

  if (allocation.debt >= 18) {
    actions.push("Set debt autopay in 2 weekly chunks to reduce interest burden faster.");
  }

  if (allocation.investments >= 10) {
    actions.push(
      `Create SIP automation of INR ${formatCurrency(Math.round((allocation.investments / 100) * monthlyIncome))} monthly.`
    );
  }

  if (!bankConnected) {
    actions.push("Connect Bank Account to enable direct spending categorization automation.");
  }

  if (!fdConnected) {
    actions.push("Connect FD to sync low-risk reserves with the automation plan.");
  }

  if (analysis.score < 45) {
    actions.push("Freeze non-essential spending for 30 days and redirect surplus to emergency buffer.");
  } else if (analysis.score >= 70) {
    actions.push("Increase annual investment allocation by 2% and review tax optimization quarterly.");
  } else {
    actions.push("Run a weekly budget audit and rebalance savings-to-investment split monthly.");
  }

  automationList.innerHTML = "";
  actions.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    automationList.appendChild(li);
  });
}

function refreshConnectionStatus() {
  const bank = localStorage.getItem(STORAGE_KEYS.bankConnected) === "true";
  const fd = localStorage.getItem(STORAGE_KEYS.fdConnected) === "true";

  if (bank && fd) {
    integrationStatus.textContent = "Bank + FD connected. Automation channels ready.";
    return;
  }

  if (bank) {
    integrationStatus.textContent = "Bank connected. FD pending.";
    return;
  }

  if (fd) {
    integrationStatus.textContent = "FD connected. Bank account pending.";
    return;
  }

  integrationStatus.textContent = "No financial connections yet.";
}

function hydrateSettings() {
  const persisted = getStoredSettings();

  settingsForm.recipientName.value = persisted.recipientName;
  settingsForm.recipientEmail.value = persisted.recipientEmail;
  settingsForm.assetList.value = persisted.assetList;
  settingsForm.customMessage.value = persisted.customMessage;
  settingsForm.emailTemplate.value = persisted.emailTemplate;

  const preview = buildEmailPreview();
  emailPreview.textContent = preview;
  enableMailto(preview);
}

function persistSettings() {
  const data = {
    recipientName: settingsForm.recipientName.value.trim() || defaultSettings.recipientName,
    recipientEmail: settingsForm.recipientEmail.value.trim() || defaultSettings.recipientEmail,
    assetList: settingsForm.assetList.value.trim() || defaultSettings.assetList,
    customMessage: settingsForm.customMessage.value.trim() || defaultSettings.customMessage,
    emailTemplate: settingsForm.emailTemplate.value.trim() || defaultSettings.emailTemplate
  };

  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(data));
}

function getStoredSettings() {
  const raw = localStorage.getItem(STORAGE_KEYS.settings);

  if (!raw) {
    return { ...defaultSettings };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      recipientName: parsed.recipientName || defaultSettings.recipientName,
      recipientEmail: parsed.recipientEmail || defaultSettings.recipientEmail,
      assetList: parsed.assetList || defaultSettings.assetList,
      customMessage: parsed.customMessage || defaultSettings.customMessage,
      emailTemplate: parsed.emailTemplate || defaultSettings.emailTemplate
    };
  } catch {
    return { ...defaultSettings };
  }
}

function buildEmailPreview() {
  const settings = getStoredSettings();

  return settings.emailTemplate
    .replaceAll("{{recipientName}}", settings.recipientName)
    .replaceAll("{{assetList}}", settings.assetList)
    .replaceAll("{{customMessage}}", settings.customMessage);
}

function enableMailto(previewBody) {
  const settings = getStoredSettings();
  const encodedSubject = encodeURIComponent("48-Day Inactivity Asset Summary");
  const encodedBody = encodeURIComponent(previewBody);

  mailtoLink.href = `mailto:${settings.recipientEmail}?subject=${encodedSubject}&body=${encodedBody}`;
  mailtoLink.setAttribute("aria-disabled", "false");
}

function startCountdown() {
  if (timerId) {
    window.clearInterval(timerId);
  }

  updateCountdown();
  timerId = window.setInterval(updateCountdown, 1000);
}

function ensureLastLoginExists() {
  if (!localStorage.getItem(STORAGE_KEYS.lastLoginAt)) {
    localStorage.setItem(STORAGE_KEYS.lastLoginAt, String(Date.now()));
  }

  if (!localStorage.getItem(STORAGE_KEYS.inactivityTriggered)) {
    localStorage.setItem(STORAGE_KEYS.inactivityTriggered, "false");
  }
}

function updateCountdown() {
  const lastLogin = Number(localStorage.getItem(STORAGE_KEYS.lastLoginAt)) || Date.now();
  const remaining = Math.max(0, lastLogin + INACTIVITY_MS - Date.now());

  const days = Math.floor(remaining / (24 * 60 * 60 * 1000));
  const hours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
  const seconds = Math.floor((remaining % (60 * 1000)) / 1000);

  countdownEl.textContent = `${pad(days)}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;

  if (remaining === 0) {
    triggerInactivityDispatch(false);
  }
}

function triggerInactivityDispatch(openMailClient) {
  const alreadyTriggered = localStorage.getItem(STORAGE_KEYS.inactivityTriggered) === "true";
  if (alreadyTriggered) {
    return;
  }

  persistSettings();
  const preview = buildEmailPreview();
  emailPreview.textContent = preview;
  enableMailto(preview);

  localStorage.setItem(STORAGE_KEYS.inactivityTriggered, "true");
  showToast("48-day inactivity threshold reached. Asset email prepared for Guy.");

  if (openMailClient) {
    window.location.href = mailtoLink.href;
  }
}

function showDashboard() {
  loginView.classList.add("hidden");
  dashboardView.classList.remove("hidden");
}

function showLoginOnly() {
  loginView.classList.remove("hidden");
  dashboardView.classList.add("hidden");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(showToast.timeoutRef);
  showToast.timeoutRef = window.setTimeout(() => {
    toast.classList.remove("visible");
  }, 2200);
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function clearLoginFeedback() {
  loginError.textContent = "";
}

function setSecurityStatus(message) {
  securityStatus.textContent = message;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN").format(value);
}
