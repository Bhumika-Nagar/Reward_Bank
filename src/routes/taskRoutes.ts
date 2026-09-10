import { Router } from "express";

import db from "../database";
import { authMiddleware } from "../middleware/authMiddleware";
import {
  approveTask,
  createTask,
  markTaskDone,
  rejectTask,
} from "../services/taskService";

type AuthenticatedUser = {
  id: string;
  role: "parent" | "child";
};

type ChildRow = {
  id: string;
};

type TaskRow = {
  child_id: string;
};

const router = Router();

const findParentsChild = db.prepare(
  "SELECT id FROM children WHERE id = ? AND parent_id = ?"
);

const findTask = db.prepare("SELECT child_id FROM tasks WHERE id = ?");

const findParentsTask = db.prepare(`
  SELECT tasks.child_id
  FROM tasks
  JOIN children ON children.id = tasks.child_id
  WHERE tasks.id = ? AND children.parent_id = ?
`);

router.use(authMiddleware);

router.post("/tasks", (req, res) => {
  const user = res.locals.user as AuthenticatedUser;

  if (user.role !== "parent") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { childId, title, reward } = req.body;

  if (
    typeof childId !== "string" ||
    typeof title !== "string" ||
    !Number.isInteger(reward)
  ) {
    res.status(400).json({ error: "Invalid task data" });
    return;
  }

  const child = findParentsChild.get(childId, user.id) as ChildRow | undefined;

  if (!child) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    const task = createTask({ childId, title, reward });
    res.status(201).json(task);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.post("/tasks/:id/done", (req, res) => {
  const user = res.locals.user as AuthenticatedUser;

  if (user.role !== "child") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const task = findTask.get(req.params.id) as TaskRow | undefined;

  if (!task || task.child_id !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    const updatedTask = markTaskDone(req.params.id);
    res.status(200).json(updatedTask);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.post("/tasks/:id/approve", (req, res) => {
  const user = res.locals.user as AuthenticatedUser;

  if (user.role !== "parent") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const task = findParentsTask.get(req.params.id, user.id) as
    | TaskRow
    | undefined;

  if (!task) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    const result = approveTask(req.params.id);
    res.status(200).json(result.task);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.post("/tasks/:id/reject", (req, res) => {
  const user = res.locals.user as AuthenticatedUser;

  if (user.role !== "parent") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const task = findParentsTask.get(req.params.id, user.id) as
    | TaskRow
    | undefined;

  if (!task) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    const updatedTask = rejectTask(req.params.id);
    res.status(200).json(updatedTask);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

export default router;
