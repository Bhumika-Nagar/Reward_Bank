import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import app from "../src/app";
import db from "../src/database";
import { recordLedgerEntry } from "../src/services/ledgerService";

const PARENT_TOKEN = "parent-00000000-0000-4000-8000-000000000001";
const CHILD_TOKEN = "child-00000000-0000-4000-8000-000000000001";

describe("Usage Routes", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    db.prepare("DELETE FROM ledger_entries").run();
    db.prepare("DELETE FROM usage_sessions").run();
    db.prepare("DELETE FROM tasks").run();
    db.prepare("DELETE FROM children").run();
    db.prepare("DELETE FROM parents").run();

    db.prepare(`
      INSERT INTO parents (id, name, token)
      VALUES (?, ?, ?)
    `).run("parent-1", "Parent", PARENT_TOKEN);

    db.prepare(`
      INSERT INTO children (id, name, token, parent_id, balance, debt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("child-1", "Child", CHILD_TOKEN, "parent-1", 0, 0);

    recordLedgerEntry({
      childId: "child-1",
      amount: 10,
      reason: "OPENING_BALANCE",
      referenceId: "opening-balance",
    });

    server = app.listen(0, "127.0.0.1");

    await new Promise<void>((resolve) => {
      server.once("listening", resolve);
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });

  it("accepts batch usage reports through POST /usage", async () => {
    const response = await fetch(`${baseUrl}/usage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CHILD_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessions: [
          {
            id: "route-batch-normal",
            childId: "child-1",
            appId: "video",
            startTime: "2026-09-10T18:00:00.000Z",
            endTime: "2026-09-10T18:04:00.000Z",
          },
          {
            id: "route-batch-over-limit",
            childId: "child-1",
            appId: "game",
            startTime: "2026-09-10T18:10:00.000Z",
            endTime: "2026-09-10T18:19:00.000Z",
          },
        ],
      }),
    });

    expect(response.status).toBe(200);

    const data = (await response.json()) as {
      results: Array<{
        usageId: string;
        coveredMinutes: number;
        rejectedMinutes: number;
        remainingBalance: number;
      }>;
    };

    expect(data.results).toMatchObject([
      {
        usageId: "route-batch-normal",
        coveredMinutes: 4,
        rejectedMinutes: 0,
        remainingBalance: 6,
      },
      {
        usageId: "route-batch-over-limit",
        coveredMinutes: 6,
        rejectedMinutes: 3,
        remainingBalance: 0,
      },
    ]);
  });

  it("handles overlapping usage requests without overspending the balance", async () => {
    const usageRequests = [
      {
        id: "route-concurrent-app-a",
        childId: "child-1",
        appId: "video",
        startTime: "2026-09-10T19:00:00.000Z",
        endTime: "2026-09-10T19:07:00.000Z",
      },
      {
        id: "route-concurrent-app-b",
        childId: "child-1",
        appId: "game",
        startTime: "2026-09-10T19:00:00.000Z",
        endTime: "2026-09-10T19:07:00.000Z",
      },
    ];

    const responses = await Promise.all(
      usageRequests.map((session) =>
        fetch(`${baseUrl}/usage`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${CHILD_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sessions: [session] }),
        })
      )
    );

    expect(responses.every((response) => response.status === 200)).toBe(true);

    const results = (
      await Promise.all(
        responses.map(
          (response) =>
            response.json() as Promise<{
              results: Array<{
                usageId: string;
                coveredMinutes: number;
                rejectedMinutes: number;
              }>;
            }>
        )
      )
    ).flatMap((body) => body.results);

    expect(results.map((result) => result.usageId).sort()).toEqual([
      "route-concurrent-app-a",
      "route-concurrent-app-b",
    ]);
    expect(results.reduce((total, result) => total + result.coveredMinutes, 0)).toBe(10);
    expect(results.map((result) => result.coveredMinutes).sort((a, b) => a - b)).toEqual([
      3,
      7,
    ]);
    expect(results.map((result) => result.rejectedMinutes).sort((a, b) => a - b)).toEqual([
      0,
      4,
    ]);

    const child = db
      .prepare("SELECT balance FROM children WHERE id = ?")
      .get("child-1") as { balance: number };

    const ledgerTotal = db
      .prepare(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_entries WHERE child_id = ?"
      )
      .get("child-1") as { total: number };

    const usageCount = db
      .prepare(
        "SELECT COUNT(*) AS count FROM usage_sessions WHERE id IN (?, ?)"
      )
      .get("route-concurrent-app-a", "route-concurrent-app-b") as {
      count: number;
    };

    const usageLedgerEntries = db
      .prepare(
        "SELECT amount FROM ledger_entries WHERE reference_id IN (?, ?) ORDER BY rowid"
      )
      .all("route-concurrent-app-a", "route-concurrent-app-b") as {
      amount: number;
    }[];

    expect(child.balance).toBeGreaterThanOrEqual(0);
    expect(child.balance).toBe(0);
    expect(ledgerTotal.total).toBe(child.balance);
    expect(usageCount.count).toBe(2);
    expect(usageLedgerEntries.map((entry) => entry.amount)).toEqual([-7, -3]);
  });
});
