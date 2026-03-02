function listOf(text) {
  return (text || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  const d0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const exam = new Date(`${dateStr}T00:00:00`);
  return Math.ceil((exam.getTime() - d0.getTime()) / 86400000);
}

export function generatePlan(input) {
  const weak = listOf(input.weakTopics);
  const risk = listOf(input.forgettingRisk);
  const daysLeft = daysUntil(input.examDate);
  const tasks = [];

  weak.forEach((topic) => tasks.push({ id: crypto.randomUUID(), label: `Weak Focus: ${topic}`, done: false }));
  risk.forEach((topic) => tasks.push({ id: crypto.randomUUID(), label: `Spaced Review: ${topic}`, done: false }));
  tasks.push({ id: crypto.randomUUID(), label: "Mock Test (timed)", done: false });

  const notes = [
    "Plan respects productive hours first.",
    "Weak concepts get highest priority.",
    "Forgetting-risk topics are scheduled as spaced review.",
  ];

  if (typeof daysLeft === "number") {
    notes.unshift(`Exam in ${daysLeft} day(s), intensity adapted.`);
  }

  return { tasks, notes, daysLeft };
}
