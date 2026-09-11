import express from "express";

import childRoutes from "./routes/childRoutes";
import taskRoutes from "./routes/taskRoutes";
import usageRoutes from "./routes/usageRoutes";

const app = express();

app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ message: "RewardBank API is running" });
});

app.use(taskRoutes);
app.use(usageRoutes);
app.use(childRoutes);

export default app;
