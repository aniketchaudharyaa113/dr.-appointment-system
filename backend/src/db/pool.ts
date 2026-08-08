import { Pool, types } from "pg";
import dotenv from "dotenv";

dotenv.config();

// OID 1114 = timestamp without time zone. Return the raw string exactly as
// Postgres stored it, instead of pg's default behavior of constructing a
// JS Date (which would silently assume the naive value is UTC - wrong for
// the IST wall-clock values MediBook actually stores).
types.setTypeParser(1114, (val: string) => val);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export default pool;
