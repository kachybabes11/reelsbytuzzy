import app from "./app.js";
import dotenv from "dotenv";
import db from "./config/db.js";
import { ensureDatabase } from "./config/dbSetup.js";

dotenv.config();

const port = process.env.PORT || 3000;

async function start() {
  try {
    await ensureDatabase()
    console.log(`[DB] Using database connection: ${db.activeName}`)
    app.listen(port, () => {
      console.log(`Reelsbytuzzy web running on http://localhost:${port}`);
    });
  } catch (error) {
    console.error("Failed to initialize database:", error)
    process.exit(1)
  }
}

start();

