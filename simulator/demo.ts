const API_URL = "http://localhost:3000";
const PARENT_TOKEN = "parent-token";
const CHILD_TOKEN = "child-token";
const CHILD_ID = "child-1";

type ApiOptions = {
  token: string;
  method?: string;
  body?: unknown;
};

async function apiRequest(path: string, options: ApiOptions) {
  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${options.token}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(
      `${options.method ?? "GET"} ${path} failed with ${response.status}: ${text}`
    );
  }

  return data;
}

function printStep(title: string, result: unknown) {
  console.log(`\n${title}`);
  console.log(JSON.stringify(result, null, 2));
}

async function runDemo() {
  const demoId = Date.now();

  console.log("RewardBank end-to-end demo");
  console.log("Using localhost:3000");

  const createdTask = await apiRequest("/tasks", {
    method: "POST",
    token: PARENT_TOKEN,
    body: {
      childId: CHILD_ID,
      title: `Demo task ${demoId}`,
      reward: 30,
    },
  });
  printStep("1. Parent created a task", createdTask);

  const taskId = createdTask.id;

  const doneTask = await apiRequest(`/tasks/${taskId}/done`, {
    method: "POST",
    token: CHILD_TOKEN,
  });
  printStep("2. Child marked the task DONE", doneTask);

  const approvedTask = await apiRequest(`/tasks/${taskId}/approve`, {
    method: "POST",
    token: PARENT_TOKEN,
  });
  printStep("3. Parent approved the task", approvedTask);

  const balanceBeforeUsage = await apiRequest(`/children/${CHILD_ID}/balance`, {
    token: CHILD_TOKEN,
  });
  printStep("4. Child balance after approval", balanceBeforeUsage);

  const usageResult = await apiRequest("/usage", {
    method: "POST",
    token: CHILD_TOKEN,
    body: {
      id: `demo-usage-${demoId}`,
      childId: CHILD_ID,
      appId: "demo-app",
      startTime: "2026-09-11T10:00:00.000Z",
      endTime: "2026-09-11T10:12:00.000Z",
    },
  });
  printStep("5. Child reported 12 minutes of usage", {
    coveredMinutes: usageResult.coveredMinutes,
    rejectedMinutes: usageResult.rejectedMinutes,
    cutoffTime: usageResult.cutoffTime,
    remainingBalance: usageResult.remainingBalance,
  });

  const ledger = await apiRequest(`/children/${CHILD_ID}/ledger`, {
    token: PARENT_TOKEN,
  });
  printStep("6. Child ledger", ledger);
}

runDemo().catch((error) => {
  console.error("\nDemo failed");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
