import { beforeEach, describe, expect, it } from "vitest";
import db from "../src/database";
import { recordLedgerEntry } from "../src/services/ledgerService";

describe("Ledger Service", () => {
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

  it("adds minutes to the child's balance", () => {
    const entry = recordLedgerEntry({
      childId: "child-1",
      amount: 30,
      reason: "TASK_APPROVED",
      referenceId: "task-1",
    });

    expect(entry.amount).toBe(30);
    expect(entry.balanceAfter).toBe(30);

    const child = db
      .prepare("SELECT balance FROM children WHERE id = ?")
      .get("child-1") as { balance: number };

    expect(child.balance).toBe(30);
  });
});
