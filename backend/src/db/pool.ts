import { Pool, types } from "pg";
import dotenv from "dotenv";

dotenv.config();

// OID 1114 = timestamp without time zone. Return the raw string exactly as
// Postgres stored it, instead of pg's default behavior of constructing a
// JS Date (which would silently assume the naive value is UTC - wrong for
// the IST wall-clock values MediBook actually stores).
types.setTypeParser(1114, (val: string) => val);

let activePool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export function setPool(newPool: Pool): void {
  activePool = newPool;
}

export function getPool(): Pool {
  return activePool;
}

const pool = new Proxy({} as Pool, {
  get(target, prop) {
    const value = Reflect.get(activePool, prop, activePool);
    if (typeof value === "function") {
      return value.bind(activePool);
    }
    return value;
  },
});

export default pool;
