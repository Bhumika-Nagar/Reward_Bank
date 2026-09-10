import { beforeEach, describe, expect, it } from "vitest";

import db from "../src/database";
import {
  approveTask,
  createTask,
  markTaskDone,
} from "../src/services/taskService";

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
    `).run("parent-1", "Parent", "parent-token");

    db.prepare(`
      INSERT INTO children (id, name, token, parent_id, balance, debt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("child-1", "Child", "child-token", "parent-1", 0, 0);
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
});
