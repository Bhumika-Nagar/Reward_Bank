const API_URL = "http://localhost:3000";
const PARENT_TOKEN = "parent-token";
const CHILD_TOKEN = "child-token";
const CHILD_ID = "child-1";

type ApiOptions = {
  token: string;
  method?: string;
  body?: unknown;
};

type LedgerEntry = {
  amount: number;
  reason: string;
  referenceId: string;
  balanceAfter: number;
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

function printStep(title: string, lines: string[]) {
  console.log(`\n${title}`);
  for (const line of lines) {
    console.log(`  ${line}`);
  }
}

function formatAmount(amount: number) {
  return amount > 0 ? `+${amount}` : String(amount);
}

async function runDemo() {
  const demoId = Date.now();
  const usageId = `demo-usage-${demoId}`;

  console.log("RewardBank end-to-end demo");

  const createdTask = await apiRequest("/tasks", {
    method: "POST",
    token: PARENT_TOKEN,
    body: {
      childId: CHILD_ID,
      title: `Demo task ${demoId}`,
      reward: 30,
    },
  });
  printStep("1. Parent created task", [
    `Reward: ${createdTask.reward}`,
    `Status: ${createdTask.status}`,
  ]);

  const taskId = createdTask.id;

  const doneTask = await apiRequest(`/tasks/${taskId}/done`, {
    method: "POST",
    token: CHILD_TOKEN,
  });
  printStep("2. Child marked task DONE", [`Status: ${doneTask.status}`]);

  const approvedTask = await apiRequest(`/tasks/${taskId}/approve`, {
    method: "POST",
    token: PARENT_TOKEN,
  });
  printStep("3. Parent approved task", [`Status: ${approvedTask.status}`]);

  const balanceBeforeUsage = await apiRequest(`/children/${CHILD_ID}/balance`, {
    token: CHILD_TOKEN,
  });
  printStep("4. Balance after approval", [
    `Balance: ${balanceBeforeUsage.balance}`,
  ]);

  const usageResult = await apiRequest("/usage", {
    method: "POST",
    token: CHILD_TOKEN,
    body: {
      id: usageId,
      childId: CHILD_ID,
      appId: "demo-app",
      startTime: "2026-09-11T10:00:00.000Z",
      endTime: "2026-09-11T10:12:00.000Z",
    },
  });
  printStep("5. Child reported 12 minutes of usage", [
    `Covered: ${usageResult.coveredMinutes}`,
    `Rejected: ${usageResult.rejectedMinutes}`,
    `Cutoff: ${usageResult.cutoffTime ?? "none"}`,
    `Remaining balance: ${usageResult.remainingBalance}`,
  ]);

  const ledger = await apiRequest(`/children/${CHILD_ID}/ledger`, {
    token: PARENT_TOKEN,
  }) as LedgerEntry[];

  const demoLedgerEntries = ledger.filter(
    (entry) => entry.referenceId === taskId || entry.referenceId === usageId
  );

  printStep(
    "6. Ledger entries from this demo",
    demoLedgerEntries.map(
      (entry) =>
        `${formatAmount(entry.amount)} ${entry.reason} -> balance ${entry.balanceAfter}`
    )
  );
}

runDemo().catch((error) => {
  console.error("\nDemo failed");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
