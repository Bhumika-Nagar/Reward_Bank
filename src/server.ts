import express from "express";

const app = express();

app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ message: "RewardBank API is running" });
});

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`RewardBank running on http://localhost:${PORT}`);
});