import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import app from "../src/app";
import db from "../src/database";

const PARENT_TOKEN = "parent-00000000-0000-4000-8000-000000000001";
const CHILD_TOKEN = "child-00000000-0000-4000-8000-000000000001";

describe("Auth Middleware", () => {
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
    `).run("child-1", "Child", CHILD_TOKEN, "parent-1", 10, 0);

    db.prepare(`
      INSERT INTO parents (id, name, token)
      VALUES (?, ?, ?)
    `).run("parent-with-child-token", "Wrong Parent", CHILD_TOKEN);

    db.prepare(`
      INSERT INTO children (id, name, token, parent_id, balance, debt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("child-with-parent-token", "Wrong Child", PARENT_TOKEN, "parent-1", 10, 0);

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

  it("authenticates a parent-prefixed token as a parent", async () => {
    const response = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PARENT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        childId: "child-1",
        title: "Read",
        reward: 10,
      }),
    });

    expect(response.status).toBe(201);
  });

  it("authenticates a child-prefixed token as a child", async () => {
    const response = await fetch(`${baseUrl}/usage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CHILD_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessions: [
          {
            id: "auth-child-usage",
            childId: "child-1",
            appId: "video",
            startTime: "2026-09-10T18:00:00.000Z",
            endTime: "2026-09-10T18:03:00.000Z",
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
  });

  it("does not treat a child-prefixed token as a parent token", async () => {
    const response = await fetch(`${baseUrl}/tasks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CHILD_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        childId: "child-1",
        title: "Read",
        reward: 10,
      }),
    });

    expect(response.status).toBe(403);
  });

  it("does not treat a parent-prefixed token as a child token", async () => {
    const response = await fetch(`${baseUrl}/usage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PARENT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessions: [
          {
            id: "auth-parent-usage",
            childId: "child-1",
            appId: "video",
            startTime: "2026-09-10T18:00:00.000Z",
            endTime: "2026-09-10T18:03:00.000Z",
          },
        ],
      }),
    });

    expect(response.status).toBe(403);
  });
});
