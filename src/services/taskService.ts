import { randomUUID } from "node:crypto";

import db from "../database";
import {
  LedgerEntry,
  recordLedgerEntryInCurrentTransaction,
} from "./ledgerService";

export type TaskStatus = "PENDING" | "DONE" | "APPROVED" | "REJECTED";

export interface Task {
  id: string;
  childId: string;
  title: string;
  reward: number;
  status: TaskStatus;
  createdAt: string;
  completedAt: string | null;
  approvedAt: string | null;
}

export interface CreateTaskInput {
  childId: string;
  title: string;
  reward: number;
}

interface TaskRow {
  id: string;
  child_id: string;
  title: string;
  reward: number;
  status: TaskStatus;
  created_at: string;
  completed_at: string | null;
  approved_at: string | null;
}

const getChild = db.prepare("SELECT id FROM children WHERE id = ?");

const getTaskById = db.prepare("SELECT * FROM tasks WHERE id = ?");

const insertTask = db.prepare(`
  INSERT INTO tasks (
    id,
    child_id,
    title,
    reward,
    status,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?)
`);

const updateTaskDone = db.prepare(`
  UPDATE tasks
  SET status = ?, completed_at = ?
  WHERE id = ?
`);

const updateTaskApproved = db.prepare(`
  UPDATE tasks
  SET status = ?, approved_at = ?
  WHERE id = ?
`);

const updateTaskRejected = db.prepare(`
  UPDATE tasks
  SET status = ?
  WHERE id = ?
`);

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    childId: row.child_id,
    title: row.title,
    reward: row.reward,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    approvedAt: row.approved_at,
  };
}

function requireTask(taskId: string): TaskRow {
  const task = getTaskById.get(taskId) as TaskRow | undefined;

  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  return task;
}

export function createTask(input: CreateTaskInput): Task {
  if (!input.childId.trim()) {
    throw new Error("childId is required");
  }

  if (!input.title.trim()) {
    throw new Error("title is required");
  }

  if (!Number.isInteger(input.reward) || input.reward <= 0) {
    throw new Error("reward must be a positive integer");
  }

  const child = getChild.get(input.childId);

  if (!child) {
    throw new Error(`Child not found: ${input.childId}`);
  }

  const task: Task = {
    id: randomUUID(),
    childId: input.childId,
    title: input.title,
    reward: input.reward,
    status: "PENDING",
    createdAt: new Date().toISOString(),
    completedAt: null,
    approvedAt: null,
  };

  insertTask.run(
    task.id,
    task.childId,
    task.title,
    task.reward,
    task.status,
    task.createdAt
  );

  return task;
}

export function markTaskDone(taskId: string): Task {
  if (!taskId.trim()) {
    throw new Error("taskId is required");
  }

  const task = requireTask(taskId);

  if (task.status !== "PENDING") {
    throw new Error("Only a PENDING task can be marked done");
  }

  const completedAt = new Date().toISOString();

  updateTaskDone.run("DONE", completedAt, task.id);

  return {
    ...mapTask(task),
    status: "DONE",
    completedAt,
  };
}

const approveTaskTransaction = db.transaction(
  (taskId: string): { task: Task; ledgerEntry: LedgerEntry } => {
    const task = requireTask(taskId);

    if (task.status !== "DONE") {
      throw new Error("Only a DONE task can be approved");
    }

    const approvedAt = new Date().toISOString();

    updateTaskApproved.run("APPROVED", approvedAt, task.id);

    const ledgerEntry = recordLedgerEntryInCurrentTransaction({
      childId: task.child_id,
      amount: task.reward,
      reason: "TASK_APPROVED",
      referenceId: task.id,
    });

    return {
      task: {
        ...mapTask(task),
        status: "APPROVED",
        approvedAt,
      },
      ledgerEntry,
    };
  }
);

export function approveTask(taskId: string): {
  task: Task;
  ledgerEntry: LedgerEntry;
} {
  if (!taskId.trim()) {
    throw new Error("taskId is required");
  }

  return approveTaskTransaction(taskId);
}

export function rejectTask(taskId: string): Task {
  if (!taskId.trim()) {
    throw new Error("taskId is required");
  }

  const task = requireTask(taskId);

  if (task.status !== "DONE") {
    throw new Error("Only a DONE task can be rejected");
  }

  updateTaskRejected.run("REJECTED", task.id);

  return {
    ...mapTask(task),
    status: "REJECTED",
  };
}
