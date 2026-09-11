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
  reason: string;
  referenceId: string;
  balanceAfter: number;
};

type ChildState = {
  balance: number;
  debt: number;
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
  const parentToken = `${runId}-parent-token`;
  const childToken = `${runId}-child-token`;

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
    (entry) =>
      `Ledger: ${formatAmount(entry.amount)} ${entry.reason} -> balance ${entry.balanceAfter}`
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

    const zeroingUsage = await apiRequest("/usage", {
      method: "POST",
      token: childToken,
      body: {
        id: `${runId}-usage-to-zero`,
        childId,
        appId: "demo-app",
        startTime: "2026-09-11T10:00:00.000Z",
        endTime: "2026-09-11T10:10:00.000Z",
      },
    });
    printNewLedger("4. Usage consumed the balance", [
      `Covered: ${zeroingUsage.coveredMinutes}`,
      `Rejected: ${zeroingUsage.rejectedMinutes}`,
      `Remaining balance: ${zeroingUsage.remainingBalance}`,
    ]);

    const rejectedUsage = await apiRequest("/usage", {
      method: "POST",
      token: childToken,
      body: {
        id: `${runId}-usage-rejected-at-zero`,
        childId,
        appId: "demo-app",
        startTime: "2026-09-11T10:15:00.000Z",
        endTime: "2026-09-11T10:20:00.000Z",
      },
    });
    printNewLedger("5. Additional usage was rejected at zero", [
      `Covered: ${rejectedUsage.coveredMinutes}`,
      `Rejected: ${rejectedUsage.rejectedMinutes}`,
      `Cutoff: ${rejectedUsage.cutoffTime ?? "none"}`,
      `Remaining balance: ${rejectedUsage.remainingBalance}`,
    ]);

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

    printNewLedger("6. Parent approved another reward", [
      `Status: ${secondApprovedTask.status}`,
      `Reward: ${secondTask.reward}`,
      `Debt repaid: ${debtRepaid}`,
      `Added to balance: ${addedToBalance}`,
      `Remaining debt: ${childAfterSecondApproval.debt}`,
      `Balance: ${childAfterSecondApproval.balance}`,
    ]);

    const resumedUsage = await apiRequest("/usage", {
      method: "POST",
      token: childToken,
      body: {
        id: `${runId}-usage-resumed`,
        childId,
        appId: "demo-app",
        startTime: "2026-09-11T10:30:00.000Z",
        endTime: "2026-09-11T10:33:00.000Z",
      },
    });
    printNewLedger("7. Usage resumed after the new reward", [
      `Covered: ${resumedUsage.coveredMinutes}`,
      `Rejected: ${resumedUsage.rejectedMinutes}`,
      `Remaining balance: ${resumedUsage.remainingBalance}`,
    ]);

    const undoResult = await apiRequest(`/tasks/${secondTask.id}/undo`, {
      method: "POST",
      token: parentToken,
    });
    const childAfterUndo = readChildState(childId);
    printNewLedger("8. Parent undid the approved reward", [
      `Status: ${undoResult.task.status}`,
      `Removed from balance: ${undoResult.amountRemovedFromBalance}`,
      `Debt added: ${undoResult.debtAdded}`,
      `Balance: ${childAfterUndo.balance}`,
      `Debt: ${childAfterUndo.debt}`,
    ]);

    const ledgerTotal = getLedgerTotal.get(childId) as { total: number };
    const finalChild = readChildState(childId);

    if (ledgerTotal.total !== finalChild.balance) {
      throw new Error(
        `Ledger invariant failed: ledger sum ${ledgerTotal.total} != child balance ${finalChild.balance}`
      );
    }

    printStep("9. Invariant verified", [
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
