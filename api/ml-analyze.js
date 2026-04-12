const QUIZ_META = [
  { id: "q1", weight: 1.3 },
  { id: "q2", weight: 1.1 },
  { id: "q3", weight: 1.0 },
  { id: "q4", weight: 1.3, invert: true },
  { id: "q5", weight: 1.3 },
  { id: "q6", weight: 1.1 },
  { id: "q7", weight: 1.2 },
  { id: "q8", weight: 1.0 },
  { id: "q9", weight: 1.3 },
  { id: "q10", weight: 1.2 },
  { id: "q11", weight: 1.1 },
  { id: "q12", weight: 1.0 },
  { id: "q13", weight: 1.2 },
  { id: "q14", weight: 1.1 },
  { id: "q15", weight: 1.1 },
  { id: "q16", weight: 1.0 },
  { id: "q17", weight: 1.0 },
  { id: "q18", weight: 0.9 },
  { id: "q19", weight: 0.9 },
  { id: "q20", weight: 1.1 }
];

function estimateIncome(answer) {
  const map = {
    1: 30000,
    2: 60000,
    3: 100000,
    4: 160000,
    5: 250000
  };
  return map[answer] || 60000;
}

function getProfile(score) {
  if (score < 45) {
    return "Defensive Reset";
  }
  if (score < 70) {
    return "Stability Builder";
  }
  return "Growth Optimizer";
}

function normalizeAllocation(allocation) {
  const floorApplied = Object.fromEntries(
    Object.entries(allocation).map(([key, value]) => [key, Math.max(2, value)])
  );

  const total = Object.values(floorApplied).reduce((sum, value) => sum + value, 0);
  const normalized = {};

  for (const [key, value] of Object.entries(floorApplied)) {
    normalized[key] = Math.round((value / total) * 100);
  }

  const finalTotal = Object.values(normalized).reduce((sum, value) => sum + value, 0);
  normalized.essentials += 100 - finalTotal;
  return normalized;
}

function buildAllocation(score, answers) {
  let allocation;

  if (score < 45) {
    allocation = { essentials: 50, debt: 24, savings: 14, investments: 4, lifestyle: 8 };
  } else if (score < 70) {
    allocation = { essentials: 47, debt: 16, savings: 20, investments: 9, lifestyle: 8 };
  } else {
    allocation = { essentials: 44, debt: 10, savings: 21, investments: 17, lifestyle: 8 };
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

function parseBody(body) {
  if (!body) {
    return {};
  }

  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }

  return body;
}

export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST for ml-analyze" });
  }

  const payload = parseBody(req.body);
  const answers = payload.answers;

  if (!answers || typeof answers !== "object") {
    return res.status(400).json({ error: "Missing answers object" });
  }

  let weightedScore = 0;
  let weightedMax = 0;

  for (const meta of QUIZ_META) {
    const value = Number(answers[meta.id]);
    if (!Number.isFinite(value) || value < 1 || value > 5) {
      return res.status(400).json({ error: `Invalid value for ${meta.id}` });
    }

    const normalized = meta.invert ? 6 - value : value;
    weightedScore += normalized * meta.weight;
    weightedMax += 5 * meta.weight;
  }

  const score = Math.round((weightedScore / weightedMax) * 100);
  const estimatedIncome = estimateIncome(Number(answers.q2));
  const allocation = buildAllocation(score, answers);

  return res.status(200).json({
    score,
    profile: getProfile(score),
    estimatedIncome,
    allocation,
    generatedAt: new Date().toISOString()
  });
}
