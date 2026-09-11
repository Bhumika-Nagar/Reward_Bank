import { Router } from "express";

import db from "../database";
import { authMiddleware } from "../middleware/authMiddleware";

type AuthenticatedUser = {
  id: string;
  role: "parent" | "child";
};

type ChildBalanceRow = {
  balance: number;
};

type ChildRow = {
  id: string;
};

const router = Router();

const findParentsChild = db.prepare(
  "SELECT id FROM children WHERE id = ? AND parent_id = ?"
);

const getChildBalance = db.prepare(
  "SELECT balance FROM children WHERE id = ?"
);

const getChildLedger = db.prepare(`
  SELECT
    id,
    child_id AS childId,
    amount,
    debt_change AS debtChange,
    reason,
    reference_id AS referenceId,
    timestamp,
    balance_after AS balanceAfter
  FROM ledger_entries
  WHERE child_id = ?
  ORDER BY timestamp ASC
`);

function canViewChild(user: AuthenticatedUser, childId: string): boolean {
  if (user.role === "child") {
    return user.id === childId;
  }

  const child = findParentsChild.get(childId, user.id) as ChildRow | undefined;
  return Boolean(child);
}

router.use(authMiddleware);

router.get("/children/:id/balance", (req, res) => {
  const user = res.locals.user as AuthenticatedUser;
  const childId = req.params.id;

  if (!canViewChild(user, childId)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const child = getChildBalance.get(childId) as ChildBalanceRow | undefined;

  if (!child) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  res.status(200).json({
    childId,
    balance: child.balance,
  });
});

router.get("/children/:id/ledger", (req, res) => {
  const user = res.locals.user as AuthenticatedUser;
  const childId = req.params.id;

  if (!canViewChild(user, childId)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const ledgerEntries = getChildLedger.all(childId);

  res.status(200).json(ledgerEntries);
});

export default router;
