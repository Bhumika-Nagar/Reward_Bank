import { Router } from "express";

import { authMiddleware } from "../middleware/authMiddleware";
import { reportUsageSession } from "../services/usageService";

type AuthenticatedUser = {
  id: string;
  role: "parent" | "child";
};

const router = Router();

router.use(authMiddleware);

router.post("/usage", (req, res) => {
  const user = res.locals.user as AuthenticatedUser;

  if (user.role !== "child") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { id, childId, appId, startTime, endTime } = req.body;

  if (
    typeof id !== "string" ||
    typeof childId !== "string" ||
    typeof appId !== "string" ||
    typeof startTime !== "string" ||
    typeof endTime !== "string"
  ) {
    res.status(400).json({ error: "Invalid usage data" });
    return;
  }

  if (childId !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    const result = reportUsageSession({
      id,
      childId,
      appId,
      startTime,
      endTime,
    });

    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

export default router;
