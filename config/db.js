import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

function parseRequiredPort(name) {
  const value = process.env[name];
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(
      `Environment variable ${name} must be a valid port number.`,
    );
  }

  return parsed;
}

const fallbackConfig =
  process.env.PG_USER &&
  process.env.PG_HOST &&
  process.env.PG_DATABASE &&
  process.env.PG_PASSWORD &&
  process.env.PG_PORT
    ? {
        user: process.env.PG_USER,
        host: process.env.PG_HOST,
        database: process.env.PG_DATABASE,
        password: process.env.PG_PASSWORD,
        port: parseRequiredPort("PG_PORT"),
        ssl:
          process.env.PG_SSL === "true" ? { rejectUnauthorized: false } : false,
      }
    : null;

const usePrimaryDatabase =
  process.env.NODE_ENV === "production" || !fallbackConfig;

const primaryConfig = usePrimaryDatabase && process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,
      },
    }
  : null;

const primaryPool = primaryConfig ? new Pool(primaryConfig) : null;
const fallbackPool = fallbackConfig ? new Pool(fallbackConfig) : null;

let activePool = primaryPool || fallbackPool;
let activeName = primaryPool ? "primary" : fallbackPool ? "fallback" : null;

function logFallback(error) {
  console.warn(
    "[DB] Primary database unavailable. Falling back to local database.",
    error?.message || error,
  );
}

function switchToFallback(error) {
  if (!fallbackPool || activePool === fallbackPool) {
    throw error;
  }

  logFallback(error);

  activePool = fallbackPool;
  activeName = "fallback";

  return activePool;
}

async function query(...args) {
  if (!activePool) {
    throw new Error("No database connection is configured.");
  }

  try {
    return await activePool.query(...args);
  } catch (error) {
    if (primaryPool && fallbackPool && activePool === primaryPool) {
      const pool = switchToFallback(error);
      return pool.query(...args);
    }

    throw error;
  }
}

async function connect() {
  if (!activePool) {
    throw new Error("No database connection is configured.");
  }

  return activePool.connect();
}

async function end() {
  const pools = [primaryPool, fallbackPool].filter(Boolean);

  await Promise.all(pools.map((pool) => pool.end()));
}

const db = {
  query,
  connect,
  getPool() {
    if (!activePool) {
      throw new Error("No database connection is configured.");
    }
    return activePool;
  },
  end,

  get activeName() {
    return activeName;
  },

  isUsingFallback() {
    return activeName === "fallback";
  },
};

export default db;
