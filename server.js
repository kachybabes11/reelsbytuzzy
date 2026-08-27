import app from "./app.js";

import { ensureDatabase } from "./database/dbSetup.js";

import { runPaymentReconciliation } from "./jobs/reconcilePayments.js";
import { expireBookingHolds } from "./jobs/expireBookingHolds.js";

const PORT = process.env.PORT || 3000;

const start = async () => {
  try {
    await ensureDatabase().then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    }); })
  } catch (error) {
    console.error("Failed to ensure database:", error);
    process.exit(1);
  }
};

start();

setInterval(runPaymentReconciliation, 5 * 60 * 1000);

setInterval(expireBookingHolds, 60 * 1000);
