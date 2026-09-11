import { NextFunction, Request, Response } from "express";

import db from "../database";

type AuthenticatedUser = {
  id: string;
  role: "parent" | "child";
};

type UserRow = {
  id: string;
};

const findParentByToken = db.prepare("SELECT id FROM parents WHERE token = ?");
const findChildByToken = db.prepare("SELECT id FROM children WHERE token = ?");

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = authHeader.slice("Bearer ".length).trim();

  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (token.startsWith("parent-")) {
    const parent = findParentByToken.get(token) as UserRow | undefined;

    if (parent) {
      res.locals.user = {
        id: parent.id,
        role: "parent",
      } satisfies AuthenticatedUser;
      next();
      return;
    }

    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (token.startsWith("child-")) {
    const child = findChildByToken.get(token) as UserRow | undefined;

    if (child) {
      res.locals.user = {
        id: child.id,
        role: "child",
      } satisfies AuthenticatedUser;
      next();
      return;
    }

    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.status(401).json({ error: "Unauthorized" });
}
