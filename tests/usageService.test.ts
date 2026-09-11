import { beforeEach, describe, expect, it } from "vitest";

import db from "../src/database";
import {
  reportUsageSession,
  reportUsageSessions,
} from "../src/services/usageService";

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

  it("processes a batch in request order without letting balance go negative", () => {
    const results = reportUsageSessions([
      {
        id: "batch-normal",
        childId: "child-1",
        appId: "reading-app",
        startTime: "2026-09-10T15:00:00.000Z",
        endTime: "2026-09-10T15:04:00.000Z",
      },
      {
        id: "batch-over-limit",
        childId: "child-1",
        appId: "video-app",
        startTime: "2026-09-10T15:10:00.000Z",
        endTime: "2026-09-10T15:19:00.000Z",
      },
    ]);

    expect(results).toMatchObject([
      {
        usageId: "batch-normal",
        coveredMinutes: 4,
        rejectedMinutes: 0,
        remainingBalance: 6,
      },
      {
        usageId: "batch-over-limit",
        coveredMinutes: 6,
        rejectedMinutes: 3,
        cutoffTime: "2026-09-10T15:16:00.000Z",
        remainingBalance: 0,
      },
    ]);

    const child = db
      .prepare("SELECT balance FROM children WHERE id = ?")
      .get("child-1") as { balance: number };

    expect(child.balance).toBe(0);

    const ledgerEntries = db
      .prepare(
        "SELECT amount, reason, reference_id FROM ledger_entries ORDER BY rowid"
      )
      .all();

    expect(ledgerEntries).toEqual([
      {
        amount: -4,
        reason: "USAGE",
        reference_id: "batch-normal",
      },
      {
        amount: -6,
        reason: "USAGE",
        reference_id: "batch-over-limit",
      },
    ]);
  });

  it("does not charge duplicate usage sessions inside a batch twice", () => {
    const usage = {
      id: "batch-duplicate",
      childId: "child-1",
      appId: "game",
      startTime: "2026-09-10T16:00:00.000Z",
      endTime: "2026-09-10T16:03:00.000Z",
    };

    const results = reportUsageSessions([usage, usage]);

    expect(results).toMatchObject([
      {
        usageId: "batch-duplicate",
        coveredMinutes: 3,
        rejectedMinutes: 0,
        remainingBalance: 7,
      },
      {
        usageId: "batch-duplicate",
        coveredMinutes: 3,
        rejectedMinutes: 0,
        remainingBalance: 7,
      },
    ]);

    const child = db
      .prepare("SELECT balance FROM children WHERE id = ?")
      .get("child-1") as { balance: number };

    expect(child.balance).toBe(7);

    const ledgerCount = db
      .prepare("SELECT COUNT(*) AS count FROM ledger_entries WHERE reference_id = ?")
      .get("batch-duplicate") as { count: number };

    expect(ledgerCount.count).toBe(1);
  });

  it("rolls back the whole batch when one session is invalid", () => {
    expect(() =>
      reportUsageSessions([
        {
          id: "batch-before-invalid",
          childId: "child-1",
          appId: "video",
          startTime: "2026-09-10T17:00:00.000Z",
          endTime: "2026-09-10T17:05:00.000Z",
        },
        {
          id: "batch-invalid",
          childId: "child-1",
          appId: "video",
          startTime: "2026-09-10T17:10:00.000Z",
          endTime: "2026-09-10T17:09:00.000Z",
        },
      ])
    ).toThrow("startTime must be before endTime");

    const child = db
      .prepare("SELECT balance FROM children WHERE id = ?")
      .get("child-1") as { balance: number };

    const usageCount = db
      .prepare("SELECT COUNT(*) AS count FROM usage_sessions")
      .get() as { count: number };

    const ledgerCount = db
      .prepare("SELECT COUNT(*) AS count FROM ledger_entries")
      .get() as { count: number };

    expect(child.balance).toBe(10);
    expect(usageCount.count).toBe(0);
    expect(ledgerCount.count).toBe(0);
  });
});
