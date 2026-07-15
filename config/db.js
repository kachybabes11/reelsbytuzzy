import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

const primaryConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,
      },
    }
  : null;

const fallbackConfig =
  process.env.PG_USER && process.env.PG_HOST && process.env.PG_DATABASE && process.env.PG_PASSWORD
    ? {
        user: process.env.PG_USER,
        host: process.env.PG_HOST,
        database: process.env.PG_DATABASE,
        password: process.env.PG_PASSWORD,
        port: Number(process.env.PG_PORT || 5432),
        ssl: process.env.PG_SSL === "true" ? { rejectUnauthorized: false } : false,
      }
    : null;

const primaryPool = primaryConfig ? new Pool(primaryConfig) : null;
const fallbackPool = fallbackConfig ? new Pool(fallbackConfig) : null;
let activePool = primaryPool || fallbackPool;
let activeName = primaryPool ? "primary" : fallbackPool ? "fallback" : null;

function logFallback(reason) {
  console.warn("[DB] Primary database unavailable, falling back to local database.", reason?.message || reason);
}

async function switchToFallback(reason) {
  if (!fallbackPool || activePool === fallbackPool) {
    throw reason
  }
  logFallback(reason)
  activePool = fallbackPool
  activeName = "fallback"
  return activePool
}

async function query(...args) {
  if (!activePool) {
    throw new Error("No database connection is configured.")
  }
  try {
    return await activePool.query(...args)
  } catch (error) {
    if (primaryPool && fallbackPool && activePool === primaryPool) {
      await switchToFallback(error)
      return await activePool.query(...args)
    }
    throw error
  }
}

async function connect() {
  if (!activePool) {
    throw new Error("No database connection is configured.")
  }
  return activePool.connect()
}

async function end() {
  if (primaryPool) await primaryPool.end()
  if (fallbackPool) await fallbackPool.end()
}

const db = {
  query,
  connect,
  end,
  get activeName() {
    return activeName
  },
  isUsingFallback() {
    return activeName === "fallback"
  },
};

export default db;
