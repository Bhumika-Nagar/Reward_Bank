import { randomUUID } from "node:crypto";
import type { Server } from "node:http";

import db from "../src/database";
import serverModule from "../src/server";

const API_URL = "http://127.0.0.1:3000";

type ApiOptions = {
  token: string;
  method?: string;
  body?: unknown;
};

type LedgerEntry = {
  amount: number;
  debtChange: number;
  reason: string;
  referenceId: string;
  balanceAfter: number;
};

type ChildState = {
  balance: number;
  debt: number;
};

type UsageSessionPayload = {
  id: string;
  childId: string;
  appId: string;
  startTime: string;
  endTime: string;
};

type UsageResult = {
  usageId: string;
  coveredMinutes: number;
  rejectedMinutes: number;
  cutoffTime: string | null;
  remainingBalance: number;
};

type UsageBatchResult = {
  results: UsageResult[];
};

const insertParent = db.prepare(`
  INSERT INTO parents (id, name, token)
  VALUES (?, ?, ?)
`);

const insertChild = db.prepare(`
  INSERT INTO children (id, name, token, parent_id, balance, debt)
  VALUES (?, ?, ?, ?, 0, 0)
`);

const getDemoLedgerEntries = db.prepare(`
  SELECT
    amount,
    debt_change AS debtChange,
    reason,
    reference_id AS referenceId,
    balance_after AS balanceAfter
  FROM ledger_entries
  WHERE child_id = ?
  ORDER BY rowid ASC
`);

const getChildState = db.prepare(
  "SELECT balance, debt FROM children WHERE id = ?"
);

const getLedgerTotal = db.prepare(
  "SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_entries WHERE child_id = ?"
);

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

async function apiRequestExpectingError(path: string, options: ApiOptions) {
  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${options.token}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();

  if (response.ok) {
    throw new Error(
      `${options.method ?? "GET"} ${path} unexpectedly succeeded: ${text}`
    );
  }

  return {
    status: response.status,
    body: text ? (JSON.parse(text) as { error?: string }) : null,
  };
}

async function isServerReady(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/`);
    if (!response.ok) {
      return false;
    }

    const data = (await response.json()) as { message?: string };
    return data.message === "RewardBank API is running";
  } catch {
    return false;
  }
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await isServerReady()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("Timed out waiting for the server to start");
}

async function ensureServer(): Promise<Server | null> {
  if (await isServerReady()) {
    return null;
  }

  const server = serverModule.startServer();
  try {
    await waitForServer();
  } catch (error) {
    await stopServer(server);
    throw error;
  }

  return server;
}

function seedDemoUsers(runId: string) {
  const parentId = `${runId}-parent`;
  const childId = `${runId}-child`;
  const parentToken = `parent-${randomUUID()}`;
  const childToken = `child-${randomUUID()}`;

  insertParent.run(parentId, "Demo Parent", parentToken);
  insertChild.run(childId, "Demo Child", childToken, parentId);

  return {
    childId,
    childToken,
    parentToken,
  };
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

async function reportUsageBatch(
  token: string,
  sessions: UsageSessionPayload[]
): Promise<UsageBatchResult> {
  return (await apiRequest("/usage", {
    method: "POST",
    token,
    body: { sessions },
  })) as UsageBatchResult;
}

function formatUsageResults(results: UsageResult[]): string[] {
  return results.map(
    (result) =>
      `${result.usageId}: covered ${result.coveredMinutes}, rejected ${result.rejectedMinutes}, cutoff ${result.cutoffTime ?? "none"}, balance ${result.remainingBalance}`
  );
}

function readChildState(childId: string): ChildState {
  const child = getChildState.get(childId) as ChildState | undefined;

  if (!child) {
    throw new Error(`Demo child not found: ${childId}`);
  }

  return child;
}

function formatLedger(entries: LedgerEntry[], printedCount: number): string[] {
  const newEntries = entries.slice(printedCount);

  if (newEntries.length === 0) {
    return ["Ledger: no new entries"];
  }

  return newEntries.map(
    (entry) => {
      const debtChange =
        entry.debtChange === 0
          ? ""
          : `, debt ${formatAmount(entry.debtChange)}`;

      return `Ledger: ${formatAmount(entry.amount)} ${entry.reason}${debtChange} -> balance ${entry.balanceAfter}`;
    }
  );
}

function getDemoLedger(childId: string): LedgerEntry[] {
  return getDemoLedgerEntries.all(childId) as LedgerEntry[];
}

function stopServer(server: Server | null): Promise<void> {
  if (!server || !server.listening) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

async function runDemo() {
  const runId = `demo-${randomUUID()}`;
  const server = await ensureServer();
  const { childId, childToken, parentToken } = seedDemoUsers(runId);
  let printedLedgerCount = 0;

  function printNewLedger(title: string, lines: string[] = []) {
    const ledger = getDemoLedger(childId);
    printStep(title, [...lines, ...formatLedger(ledger, printedLedgerCount)]);
    printedLedgerCount = ledger.length;
  }

  try {
    console.log("RewardBank end-to-end demo");
    console.log(`Run: ${runId}`);

    const firstTask = await apiRequest("/tasks", {
      method: "POST",
      token: parentToken,
      body: {
        childId,
        title: "Demo: earn first reward",
        reward: 10,
      },
    });
    printNewLedger("1. Parent created task", [
      `Task: ${firstTask.id}`,
      `Reward: ${firstTask.reward}`,
      `Status: ${firstTask.status}`,
    ]);

    const doneTask = await apiRequest(`/tasks/${firstTask.id}/done`, {
      method: "POST",
      token: childToken,
    });
    printNewLedger("2. Child marked task DONE", [`Status: ${doneTask.status}`]);

    const approvedTask = await apiRequest(`/tasks/${firstTask.id}/approve`, {
      method: "POST",
      token: parentToken,
    });
    printNewLedger("3. Parent approved task", [
      `Status: ${approvedTask.status}`,
      `Balance: ${readChildState(childId).balance}`,
    ]);

    const normalUsageSession = {
      id: `${runId}-usage-normal-day`,
      childId,
      appId: "demo-app",
      startTime: "2026-09-11T10:00:00.000Z",
      endTime: "2026-09-11T10:04:00.000Z",
    };
    const normalUsage = await reportUsageBatch(childToken, [normalUsageSession]);
    printNewLedger("4. Batch normal-day usage", formatUsageResults(normalUsage.results));

    const overLimitUsage = await reportUsageBatch(childToken, [
      {
        id: `${runId}-usage-to-zero`,
        childId,
        appId: "demo-app",
        startTime: "2026-09-11T10:10:00.000Z",
        endTime: "2026-09-11T10:18:00.000Z",
      },
    ]);
    printNewLedger(
      "5. Batch usage exceeded the remaining balance",
      formatUsageResults(overLimitUsage.results)
    );

    const duplicateUsage = await reportUsageBatch(childToken, [normalUsageSession]);
    printNewLedger(
      "6. Batch duplicate usage report",
      formatUsageResults(duplicateUsage.results)
    );

    const secondTask = await apiRequest("/tasks", {
      method: "POST",
      token: parentToken,
      body: {
        childId,
        title: "Demo: earn another reward",
        reward: 10,
      },
    });
    await apiRequest(`/tasks/${secondTask.id}/done`, {
      method: "POST",
      token: childToken,
    });
    const childBeforeSecondApproval = readChildState(childId);
    const secondApprovedTask = await apiRequest(
      `/tasks/${secondTask.id}/approve`,
      {
        method: "POST",
        token: parentToken,
      }
    );
    const childAfterSecondApproval = readChildState(childId);
    const debtRepaid =
      childBeforeSecondApproval.debt - childAfterSecondApproval.debt;
    const addedToBalance =
      childAfterSecondApproval.balance - childBeforeSecondApproval.balance;

    if (childBeforeSecondApproval.debt === 0 && addedToBalance !== 10) {
      throw new Error(
        `Fresh child reward check failed: expected 10 added to balance, got ${addedToBalance}`
      );
    }

    printNewLedger("7. Parent approved another reward", [
      `Status: ${secondApprovedTask.status}`,
      `Reward: ${secondTask.reward}`,
      `Debt repaid: ${debtRepaid}`,
      `Added to balance: ${addedToBalance}`,
      `Remaining debt: ${childAfterSecondApproval.debt}`,
      `Balance: ${childAfterSecondApproval.balance}`,
    ]);

    const failedBatchValidSession = {
      id: `${runId}-usage-would-charge`,
      childId,
      appId: "demo-app",
      startTime: "2026-09-11T10:20:00.000Z",
      endTime: "2026-09-11T10:22:00.000Z",
    };
    const failedBatchInvalidSession = {
      id: `${runId}-usage-invalid-time`,
      childId,
      appId: "demo-app",
      startTime: "2026-09-11T10:25:00.000Z",
      endTime: "2026-09-11T10:24:00.000Z",
    };
    const balanceBeforeBadBatch = readChildState(childId).balance;
    const badBatch = await apiRequestExpectingError("/usage", {
      method: "POST",
      token: childToken,
      body: {
        sessions: [failedBatchValidSession, failedBatchInvalidSession],
      },
    });
    const balanceAfterBadBatch = readChildState(childId).balance;
    const failedBatchLedgerEntries = getDemoLedger(childId).filter((entry) =>
      [
        failedBatchValidSession.id,
        failedBatchInvalidSession.id,
      ].includes(entry.referenceId)
    );

    if (balanceBeforeBadBatch < 2) {
      throw new Error("Bad batch setup failed: valid session could not consume minutes");
    }

    if (balanceAfterBadBatch !== balanceBeforeBadBatch) {
      throw new Error("Bad batch rollback failed: child balance changed");
    }

    if (failedBatchLedgerEntries.length !== 0) {
      throw new Error("Bad batch rollback failed: ledger entries were created");
    }

    printNewLedger("8. Batch everything-goes-wrong rejected", [
      `HTTP status: ${badBatch.status}`,
      `Error: ${badBatch.body?.error ?? "unknown"}`,
      `Valid session would consume: 2`,
      `Balance unchanged: ${balanceAfterBadBatch === balanceBeforeBadBatch}`,
      `Ledger entries for failed batch sessions: ${failedBatchLedgerEntries.length}`,
    ]);

    const lateOfflineUsage = await reportUsageBatch(childToken, [
      {
        id: `${runId}-usage-late-offline`,
        childId,
        appId: "offline-game",
        startTime: "2026-09-10T23:50:00.000Z",
        endTime: "2026-09-10T23:53:00.000Z",
      },
    ]);
    printNewLedger(
      "9. Batch late/offline usage",
      formatUsageResults(lateOfflineUsage.results)
    );

    const undoResult = await apiRequest(`/tasks/${secondTask.id}/undo`, {
      method: "POST",
      token: parentToken,
    });
    const childAfterUndo = readChildState(childId);
    printNewLedger("10. Parent undid the approved reward", [
      `Status: ${undoResult.task.status}`,
      `Removed from balance: ${undoResult.amountRemovedFromBalance}`,
      `Debt added: ${undoResult.debtAdded}`,
      `Balance: ${childAfterUndo.balance}`,
      `Debt: ${childAfterUndo.debt}`,
    ]);

    const debtRepaymentTask = await apiRequest("/tasks", {
      method: "POST",
      token: parentToken,
      body: {
        childId,
        title: "Demo: repay undo debt",
        reward: 5,
      },
    });
    await apiRequest(`/tasks/${debtRepaymentTask.id}/done`, {
      method: "POST",
      token: childToken,
    });
    const childBeforeDebtRepayment = readChildState(childId);
    const debtRepaymentApproval = await apiRequest(
      `/tasks/${debtRepaymentTask.id}/approve`,
      {
        method: "POST",
        token: parentToken,
      }
    );
    const childAfterDebtRepayment = readChildState(childId);
    printNewLedger("11. Parent approved reward that repaid debt", [
      `Status: ${debtRepaymentApproval.status}`,
      `Reward: ${debtRepaymentTask.reward}`,
      `Debt repaid: ${childBeforeDebtRepayment.debt - childAfterDebtRepayment.debt}`,
      `Added to balance: ${childAfterDebtRepayment.balance - childBeforeDebtRepayment.balance}`,
      `Remaining debt: ${childAfterDebtRepayment.debt}`,
      `Balance: ${childAfterDebtRepayment.balance}`,
    ]);

    const ledgerTotal = getLedgerTotal.get(childId) as { total: number };
    const finalChild = readChildState(childId);

    if (ledgerTotal.total !== finalChild.balance) {
      throw new Error(
        `Ledger invariant failed: ledger sum ${ledgerTotal.total} != child balance ${finalChild.balance}`
      );
    }

    printStep("12. Invariant verified", [
      `SUM(ledger_entries.amount): ${ledgerTotal.total}`,
      `Child balance: ${finalChild.balance}`,
      `Child debt: ${finalChild.debt}`,
    ]);
  } finally {
    await stopServer(server);
  }
}

runDemo().catch((error) => {
  console.error("\nDemo failed");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
