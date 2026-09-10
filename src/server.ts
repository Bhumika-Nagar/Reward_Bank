import express from "express";
import taskRoutes from "./routes/taskRoutes";
import usageRoutes from "./routes/usageRoutes";
import childRoutes from "./routes/childRoutes";

const app = express();

app.use(express.json());

app.use(taskRoutes);
app.use(usageRoutes);
app.use(childRoutes);

app.get("/", (_req, res) => {
  res.json({ message: "RewardBank API is running" });
});

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`RewardBank running on http://localhost:${PORT}`);
});