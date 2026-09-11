import app from "./app";

const PORT = 3000;
const HOST = "127.0.0.1";

export function startServer() {
  return app.listen(PORT, HOST, () => {
    console.log(`RewardBank running on http://${HOST}:${PORT}`);
  });
}

export default { startServer };

if (require.main === module) {
  startServer();
}
