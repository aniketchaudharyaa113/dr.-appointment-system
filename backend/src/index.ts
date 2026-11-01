import { httpServer } from "./app";
import pool from "./db/pool";

const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
  console.log(`MediBook backend running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, closing HTTP server and pool...");
  httpServer.close(async () => {
    await pool.end();
    process.exit(0);
  });
});
