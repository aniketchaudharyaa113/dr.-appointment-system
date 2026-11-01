import { httpServer } from "./app";
import pool from "./db/pool";
import { logger } from "./lib/logger";

const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
  logger.info({ port: PORT }, `MediBook backend running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, closing HTTP server and pool...");
  httpServer.close(async () => {
    await pool.end();
    process.exit(0);
  });
});
