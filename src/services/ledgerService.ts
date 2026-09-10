import { randomUUID } from "node:crypto";

import db from "../database";

export interface RecordLedgerEntryInput {
  childId: string;
  amount: number;
  reason: string;
  referenceId: string;
}

export interface LedgerEntry {
  id: string;
  childId: string;
  amount: number;
  reason: string;
  referenceId: string;
  timestamp: string;
  balanceAfter: number;
}

interface ChildBalanceRow {
  balance: number;
}

const getChildBalance = db
  .prepare("SELECT balance FROM children WHERE id = ?")
  .pluck(false);

const insertLedgerEntry = db.prepare(`
  INSERT INTO ledger_entries (
    id,
    child_id,
    amount,
    reason,
    reference_id,
    timestamp,
    balance_after
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const updateChildBalance = db.prepare(
  "UPDATE children SET balance = ? WHERE id = ?"
);

function validateLedgerEntryInput(input: RecordLedgerEntryInput): void {
  if (!input.childId.trim()) {
    throw new Error("childId is required");
  }

  if (!Number.isInteger(input.amount)) {
    throw new Error("amount must be an integer");
  }

  if (!input.reason.trim()) {
    throw new Error("reason is required");
  }

  if (!input.referenceId.trim()) {
    throw new Error("referenceId is required");
  }
}

export function recordLedgerEntryInCurrentTransaction(
  input: RecordLedgerEntryInput
): LedgerEntry {
  validateLedgerEntryInput(input);

  const child = getChildBalance.get(input.childId) as
    | ChildBalanceRow
    | undefined;

  if (!child) {
    throw new Error(`Child not found: ${input.childId}`);
  }

  const balanceAfter = child.balance + input.amount;

  if (balanceAfter < 0) {
    throw new Error("Ledger entry would make child balance negative");
  }

  const entry: LedgerEntry = {
    id: randomUUID(),
    childId: input.childId,
    amount: input.amount,
    reason: input.reason,
    referenceId: input.referenceId,
    timestamp: new Date().toISOString(),
    balanceAfter,
  };

  insertLedgerEntry.run(
    entry.id,
    entry.childId,
    entry.amount,
    entry.reason,
    entry.referenceId,
    entry.timestamp,
    entry.balanceAfter
  );

  updateChildBalance.run(entry.balanceAfter, entry.childId);

  return entry;
}

export function recordLedgerEntry(input: RecordLedgerEntryInput): LedgerEntry {
  return db.transaction(recordLedgerEntryInCurrentTransaction)(input);
}
