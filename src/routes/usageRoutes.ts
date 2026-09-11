import { Router } from "express";

import { authMiddleware } from "../middleware/authMiddleware";
import {
  reportUsageSession,
  reportUsageSessions,
} from "../services/usageService";
import type { ReportUsageSessionInput } from "../services/usageService";

type AuthenticatedUser = {
  id: string;
  role: "parent" | "child";
};

const router = Router();

function isUsageSessionInput(value: unknown): value is ReportUsageSessionInput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const session = value as Record<string, unknown>;

  return (
    typeof session.id === "string" &&
    typeof session.childId === "string" &&
    typeof session.appId === "string" &&
    typeof session.startTime === "string" &&
    typeof session.endTime === "string"
  );
}

router.use(authMiddleware);

router.post("/usage", (req, res) => {
  const user = res.locals.user as AuthenticatedUser;

  if (user.role !== "child") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const sessions: unknown[] = Array.isArray(req.body.sessions)
    ? req.body.sessions
    : [req.body];

  if (sessions.length === 0 || !sessions.every(isUsageSessionInput)) {
    res.status(400).json({ error: "Invalid usage data" });
    return;
  }

  if (sessions.some((session) => session.childId !== user.id)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    if (Array.isArray(req.body.sessions)) {
      const results = reportUsageSessions(sessions);
      res.status(200).json({ results });
      return;
    }

    const result = reportUsageSession(sessions[0]);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

export default router;
