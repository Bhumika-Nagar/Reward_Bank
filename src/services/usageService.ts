import db from "../database";
import { recordLedgerEntryInCurrentTransaction } from "./ledgerService";

export interface ReportUsageSessionInput {
  id: string;
  childId: string;
  appId: string;
  startTime: string;
  endTime: string;
}

export interface UsageSessionResult {
  usageId: string;
  coveredMinutes: number;
  rejectedMinutes: number;
  cutoffTime: string | null;
  remainingBalance: number;
}

interface ChildBalanceRow {
  balance: number;
}

interface UsageSessionRow {
  id: string;
  child_id: string;
  covered_minutes: number;
  rejected_minutes: number;
  cutoff_time: string | null;
}

const getChildBalance = db.prepare("SELECT balance FROM children WHERE id = ?");

const getUsageSession = db.prepare(
  "SELECT id, child_id, covered_minutes, rejected_minutes, cutoff_time FROM usage_sessions WHERE id = ?"
);

const insertUsageSession = db.prepare(`
  INSERT INTO usage_sessions (
    id,
    child_id,
    app_id,
    start_time,
    end_time,
    received_at,
    covered_minutes,
    rejected_minutes,
    cutoff_time
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function reportUsageSessionInCurrentTransaction(
  input: ReportUsageSessionInput
): UsageSessionResult {
  if (!input.id.trim()) {
    throw new Error("usage id is required");
  }

  if (!input.childId.trim()) {
    throw new Error("childId is required");
  }

  if (!input.appId.trim()) {
    throw new Error("appId is required");
  }

  const start = new Date(input.startTime);
  const end = new Date(input.endTime);

  if (Number.isNaN(start.getTime())) {
    throw new Error("startTime must be a valid date");
  }

  if (Number.isNaN(end.getTime())) {
    throw new Error("endTime must be a valid date");
  }

  if (start >= end) {
    throw new Error("startTime must be before endTime");
  }

  const durationMinutes = Math.floor(
    (end.getTime() - start.getTime()) / 60_000
  );

  if (durationMinutes <= 0) {
    throw new Error("usage session must be at least one minute");
  }

  const child = getChildBalance.get(input.childId) as
    | ChildBalanceRow
    | undefined;

  if (!child) {
    throw new Error(`Child not found: ${input.childId}`);
  }

  const existingSession = getUsageSession.get(input.id) as
    | UsageSessionRow
    | undefined;

  if (existingSession) {
    if (existingSession.child_id !== input.childId) {
      throw new Error("Usage session already exists for a different child");
    }

    return {
      usageId: existingSession.id,
      coveredMinutes: existingSession.covered_minutes,
      rejectedMinutes: existingSession.rejected_minutes,
      cutoffTime: existingSession.cutoff_time,
      remainingBalance: child.balance,
    };
  }

  const coveredMinutes = Math.min(child.balance, durationMinutes);
  const rejectedMinutes = durationMinutes - coveredMinutes;
  const cutoffTime =
    rejectedMinutes > 0
      ? new Date(start.getTime() + coveredMinutes * 60_000).toISOString()
      : null;
  const receivedAt = new Date().toISOString();

  const ledgerEntry =
    coveredMinutes > 0
      ? recordLedgerEntryInCurrentTransaction({
          childId: input.childId,
          amount: -coveredMinutes,
          reason: "USAGE",
          referenceId: input.id,
        })
      : null;

  insertUsageSession.run(
    input.id,
    input.childId,
    input.appId,
    input.startTime,
    input.endTime,
    receivedAt,
    coveredMinutes,
    rejectedMinutes,
    cutoffTime
  );

  return {
    usageId: input.id,
    coveredMinutes,
    rejectedMinutes,
    cutoffTime,
    remainingBalance: ledgerEntry?.balanceAfter ?? child.balance,
  };
}

export const reportUsageSession = db.transaction(
  reportUsageSessionInCurrentTransaction
);

export const reportUsageSessions = db.transaction(
  (sessions: ReportUsageSessionInput[]): UsageSessionResult[] => {
    if (sessions.length === 0) {
      throw new Error("at least one usage session is required");
    }

    return sessions.map(reportUsageSessionInCurrentTransaction);
  }
);
