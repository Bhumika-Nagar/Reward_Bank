import { beforeEach, describe, expect, it } from "vitest";

import db from "../src/database";
import {
  approveTask,
  createTask,
  markTaskDone,
  undoTask,
} from "../src/services/taskService";
import { reportUsageSession } from "../src/services/usageService";

function assertLedgerBalanceInvariant(childId: string): void {
  const child = db
    .prepare("SELECT balance FROM children WHERE id = ?")
    .get(childId) as { balance: number };

  const ledgerTotal = db
    .prepare(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_entries WHERE child_id = ?"
    )
    .get(childId) as { total: number };

  const ledgerEntries = db
    .prepare(
      "SELECT amount, balance_after FROM ledger_entries WHERE child_id = ? ORDER BY rowid"
    )
    .all(childId) as { amount: number; balance_after: number }[];

  let runningBalance = 0;

  for (const entry of ledgerEntries) {
    runningBalance += entry.amount;
    expect(entry.balance_after).toBe(runningBalance);
  }

  expect(ledgerTotal.total).toBe(child.balance);
}

describe("Task Service", () => {
  beforeEach(() => {
    db.prepare("DELETE FROM ledger_entries").run();
    db.prepare("DELETE FROM usage_sessions").run();
    db.prepare("DELETE FROM tasks").run();
    db.prepare("DELETE FROM children").run();
    db.prepare("DELETE FROM parents").run();

    db.prepare(`
      INSERT INTO parents (id, name, token)
      VALUES (?, ?, ?)
    `).run("parent-1", "Parent", "parent-00000000-0000-4000-8000-000000000001");

    db.prepare(`
      INSERT INTO children (id, name, token, parent_id, balance, debt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("child-1", "Child", "child-00000000-0000-4000-8000-000000000001", "parent-1", 0, 0);
  });

  it("approves a completed task and credits the child's balance", () => {
    const task = createTask({
      childId: "child-1",
      title: "Read for 20 minutes",
      reward: 30,
    });

    markTaskDone(task.id);

    const result = approveTask(task.id);

    expect(result.task.status).toBe("APPROVED");

    const child = db
      .prepare("SELECT balance, debt FROM children WHERE id = ?")
      .get("child-1") as { balance: number; debt: number };

    expect(child.balance).toBe(30);
    expect(child.debt).toBe(0);

    const ledgerEntry = db
      .prepare(
        "SELECT amount, debt_change, reason, reference_id FROM ledger_entries WHERE child_id = ?"
      )
      .get("child-1") as {
      amount: number;
      debt_change: number;
      reason: string;
      reference_id: string;
    };

    expect(ledgerEntry).toEqual({
      amount: 30,
      debt_change: 0,
      reason: "TASK_APPROVED",
      reference_id: task.id,
    });
  });

  it("repays debt before crediting the child's balance", () => {
    db.prepare("UPDATE children SET balance = ?, debt = ? WHERE id = ?").run(
      0,
      20,
      "child-1"
    );

    const task = createTask({
      childId: "child-1",
      title: "Clean bedroom",
      reward: 30,
    });

    markTaskDone(task.id);

    const result = approveTask(task.id);

    expect(result.task.status).toBe("APPROVED");

    const child = db
      .prepare("SELECT balance, debt FROM children WHERE id = ?")
      .get("child-1") as { balance: number; debt: number };

    expect(child.debt).toBe(0);
    expect(child.balance).toBe(10);

    const ledgerEntries = db
      .prepare(
        "SELECT amount, debt_change, reason, reference_id FROM ledger_entries WHERE reference_id = ?"
      )
      .all(task.id);

    expect(ledgerEntries).toEqual([
      {
        amount: 10,
        debt_change: -20,
        reason: "TASK_APPROVED",
        reference_id: task.id,
      },
    ]);
  });

  it("records debt repayment even when no balance is credited", () => {
    db.prepare("UPDATE children SET balance = ?, debt = ? WHERE id = ?").run(
      0,
      40,
      "child-1"
    );

    const task = createTask({
      childId: "child-1",
      title: "Clean bedroom",
      reward: 30,
    });

    markTaskDone(task.id);
    approveTask(task.id);

    const child = db
      .prepare("SELECT balance, debt FROM children WHERE id = ?")
      .get("child-1") as { balance: number; debt: number };

    const ledgerEntry = db
      .prepare(
        "SELECT amount, debt_change, reason, reference_id FROM ledger_entries WHERE reference_id = ?"
      )
      .get(task.id);

    expect(child.balance).toBe(0);
    expect(child.debt).toBe(10);
    expect(ledgerEntry).toEqual({
      amount: 0,
      debt_change: -30,
      reason: "TASK_APPROVED",
      reference_id: task.id,
    });
  });

  it("does not approve the same task twice", () => {
    const task = createTask({
      childId: "child-1",
      title: "Practice piano",
      reward: 20,
    });

    markTaskDone(task.id);
    approveTask(task.id);

    expect(() => approveTask(task.id)).toThrow(
      "Only a DONE task can be approved"
    );

    const child = db
      .prepare("SELECT balance FROM children WHERE id = ?")
      .get("child-1") as { balance: number };

    expect(child.balance).toBe(20);

    const ledgerCount = db
      .prepare(
        "SELECT COUNT(*) AS count FROM ledger_entries WHERE reference_id = ? AND reason = ?"
      )
      .get(task.id, "TASK_APPROVED") as { count: number };

    expect(ledgerCount.count).toBe(1);
  });

  it("adds debt when an approval is undone after some minutes were spent", () => {
    const firstTask = createTask({
      childId: "child-1",
      title: "Wash dishes",
      reward: 30,
    });

    markTaskDone(firstTask.id);
    approveTask(firstTask.id);

    reportUsageSession({
      id: "usage-after-approval",
      childId: "child-1",
      appId: "game",
      startTime: "2026-09-10T13:00:00.000Z",
      endTime: "2026-09-10T13:20:00.000Z",
    });

    undoTask(firstTask.id);

    let child = db
      .prepare("SELECT balance, debt FROM children WHERE id = ?")
      .get("child-1") as { balance: number; debt: number };

    expect(child.balance).toBe(0);
    expect(child.debt).toBe(20);

    const secondTask = createTask({
      childId: "child-1",
      title: "Fold laundry",
      reward: 30,
    });

    markTaskDone(secondTask.id);
    approveTask(secondTask.id);

    child = db
      .prepare("SELECT balance, debt FROM children WHERE id = ?")
      .get("child-1") as { balance: number; debt: number };

    expect(child.balance).toBe(10);
    expect(child.debt).toBe(0);

    const ledgerEntries = db
      .prepare(
        "SELECT amount, debt_change, reason, reference_id FROM ledger_entries ORDER BY rowid"
      )
      .all();

    expect(ledgerEntries).toEqual([
      {
        amount: 30,
        debt_change: 0,
        reason: "TASK_APPROVED",
        reference_id: firstTask.id,
      },
      {
        amount: -20,
        debt_change: 0,
        reason: "USAGE",
        reference_id: "usage-after-approval",
      },
      {
        amount: -10,
        debt_change: 20,
        reason: "UNDO_APPROVAL",
        reference_id: firstTask.id,
      },
      {
        amount: 10,
        debt_change: -20,
        reason: "TASK_APPROVED",
        reference_id: secondTask.id,
      },
    ]);
  });

  it("keeps the ledger balance invariant after every balance-changing operation", () => {
    assertLedgerBalanceInvariant("child-1");

    const firstTask = createTask({
      childId: "child-1",
      title: "Read",
      reward: 30,
    });

    markTaskDone(firstTask.id);
    approveTask(firstTask.id);
    assertLedgerBalanceInvariant("child-1");

    reportUsageSession({
      id: "usage-ledger-invariant-first",
      childId: "child-1",
      appId: "video",
      startTime: "2026-09-10T14:00:00.000Z",
      endTime: "2026-09-10T14:10:00.000Z",
    });
    assertLedgerBalanceInvariant("child-1");

    const secondTask = createTask({
      childId: "child-1",
      title: "Homework",
      reward: 15,
    });

    markTaskDone(secondTask.id);
    approveTask(secondTask.id);
    assertLedgerBalanceInvariant("child-1");

    reportUsageSession({
      id: "usage-ledger-invariant-over-limit",
      childId: "child-1",
      appId: "game",
      startTime: "2026-09-10T14:20:00.000Z",
      endTime: "2026-09-10T15:10:00.000Z",
    });
    assertLedgerBalanceInvariant("child-1");

    undoTask(secondTask.id);
    assertLedgerBalanceInvariant("child-1");

    const childAfterUndo = db
      .prepare("SELECT balance, debt FROM children WHERE id = ?")
      .get("child-1") as { balance: number; debt: number };

    expect(childAfterUndo).toEqual({
      balance: 0,
      debt: 15,
    });

    const thirdTask = createTask({
      childId: "child-1",
      title: "Yard work",
      reward: 20,
    });

    markTaskDone(thirdTask.id);
    approveTask(thirdTask.id);
    assertLedgerBalanceInvariant("child-1");

    const child = db
      .prepare("SELECT balance, debt FROM children WHERE id = ?")
      .get("child-1") as { balance: number; debt: number };

    expect(child).toEqual({
      balance: 5,
      debt: 0,
    });
  });
});
