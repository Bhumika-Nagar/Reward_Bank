import { beforeEach, describe, expect, it } from "vitest";

import db from "../src/database";
import {
  approveTask,
  createTask,
  markTaskDone,
  undoTask,
} from "../src/services/taskService";
import { reportUsageSession } from "../src/services/usageService";

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
        "SELECT amount, reason, reference_id FROM ledger_entries WHERE child_id = ?"
      )
      .get("child-1") as {
      amount: number;
      reason: string;
      reference_id: string;
    };

    expect(ledgerEntry).toEqual({
      amount: 30,
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
        "SELECT amount, reason, reference_id FROM ledger_entries WHERE reference_id = ?"
      )
      .all(task.id);

    expect(ledgerEntries).toEqual([
      {
        amount: 10,
        reason: "TASK_APPROVED",
        reference_id: task.id,
      },
    ]);
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
        "SELECT amount, reason, reference_id FROM ledger_entries ORDER BY rowid"
      )
      .all();

    expect(ledgerEntries).toEqual([
      {
        amount: 30,
        reason: "TASK_APPROVED",
        reference_id: firstTask.id,
      },
      {
        amount: -20,
        reason: "USAGE",
        reference_id: "usage-after-approval",
      },
      {
        amount: -10,
        reason: "UNDO_APPROVAL",
        reference_id: firstTask.id,
      },
      {
        amount: 10,
        reason: "TASK_APPROVED",
        reference_id: secondTask.id,
      },
    ]);
  });

  it("keeps the ledger sum equal to the child balance", () => {
    const firstTask = createTask({
      childId: "child-1",
      title: "Read",
      reward: 25,
    });

    markTaskDone(firstTask.id);
    approveTask(firstTask.id);

    reportUsageSession({
      id: "usage-ledger-invariant",
      childId: "child-1",
      appId: "video",
      startTime: "2026-09-10T14:00:00.000Z",
      endTime: "2026-09-10T14:10:00.000Z",
    });

    undoTask(firstTask.id);

    const secondTask = createTask({
      childId: "child-1",
      title: "Homework",
      reward: 40,
    });

    markTaskDone(secondTask.id);
    approveTask(secondTask.id);

    const child = db
      .prepare("SELECT balance FROM children WHERE id = ?")
      .get("child-1") as { balance: number };

    const ledgerTotal = db
      .prepare("SELECT SUM(amount) AS total FROM ledger_entries WHERE child_id = ?")
      .get("child-1") as { total: number };

    const latestLedgerEntry = db
      .prepare(
        "SELECT balance_after FROM ledger_entries WHERE child_id = ? ORDER BY timestamp DESC LIMIT 1"
      )
      .get("child-1") as { balance_after: number };

    expect(ledgerTotal.total).toBe(child.balance);
    expect(latestLedgerEntry.balance_after).toBe(child.balance);
  });
});
