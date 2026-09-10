import { beforeEach, describe, expect, it } from "vitest";

import db from "../src/database";
import { reportUsageSession } from "../src/services/usageService";

describe("Usage Service", () => {
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
    `).run("child-1", "Child", "child-token", "parent-1", 10);
    });

  it("covers available minutes and rejects the rest", () => {
    const startTime = "2026-09-10T10:00:00.000Z";

    const result = reportUsageSession({
      id: "usage-1",
      childId: "child-1",
      appId: "youtube",
      startTime,
      endTime: "2026-09-10T10:15:00.000Z",
      });

    expect(result.coveredMinutes).toBe(10);
    expect(result.rejectedMinutes).toBe(5);
    expect(result.cutoffTime).toBe("2026-09-10T10:10:00.000Z");

    const child = db
      .prepare("SELECT balance FROM children WHERE id = ?")
      .get("child-1") as { balance: number };

    expect(child.balance).toBe(0);

    const ledgerEntry = db
      .prepare(
        "SELECT amount, reason FROM ledger_entries WHERE reference_id = ?"
      )
      .get("usage-1") as { amount: number; reason: string };

    expect(ledgerEntry).toEqual({
      amount: -10,
      reason: "USAGE",
      });
  });

  it("does not charge the same usage session twice", () => {
    const usage = {
      id: "usage-duplicate",
      childId: "child-1",
      appId: "youtube",
      startTime: "2026-09-10T11:00:00.000Z",
      endTime: "2026-09-10T11:06:00.000Z",
    };

    const firstResult = reportUsageSession(usage);
    const secondResult = reportUsageSession(usage);

    expect(firstResult.coveredMinutes).toBe(6);
    expect(secondResult.coveredMinutes).toBe(6);

    const child = db
      .prepare("SELECT balance FROM children WHERE id = ?")
      .get("child-1") as { balance: number };

    expect(child.balance).toBe(4);

    const ledgerCount = db
      .prepare("SELECT COUNT(*) AS count FROM ledger_entries WHERE reference_id = ?")
      .get("usage-duplicate") as { count: number };

    expect(ledgerCount.count).toBe(1);
  });

  it("processes two usage sessions without letting balance go negative", () => {
    const firstResult = reportUsageSession({
      id: "usage-first",
      childId: "child-1",
      appId: "youtube",
      startTime: "2026-09-10T12:00:00.000Z",
      endTime: "2026-09-10T12:07:00.000Z",
    });

    const secondResult = reportUsageSession({
      id: "usage-second",
      childId: "child-1",
      appId: "game",
      startTime: "2026-09-10T12:10:00.000Z",
      endTime: "2026-09-10T12:17:00.000Z",
    });

    expect(firstResult.coveredMinutes + secondResult.coveredMinutes).toBe(10);

    const child = db
      .prepare("SELECT balance FROM children WHERE id = ?")
      .get("child-1") as { balance: number };

    expect(child.balance).toBe(0);
    expect(child.balance).toBeGreaterThanOrEqual(0);

    const usageCount = db
      .prepare("SELECT COUNT(*) AS count FROM usage_sessions")
      .get() as { count: number };

    expect(usageCount.count).toBe(2);
  });
});
