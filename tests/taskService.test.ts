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
      INSERT INTO children (id, name, token, parent_id, balance)
      VALUES (?, ?, ?, ?, ?)
    `).run("child-1", "Child", "child-token", "parent-1", 0);
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
      .prepare("SELECT balance FROM children WHERE id = ?")
      .get("child-1") as { balance: number };

    expect(child.balance).toBe(30);

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
});
