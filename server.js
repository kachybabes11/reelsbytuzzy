import app from "./app.js";

import { ensureDatabase } from "./database/dbSetup.js";

import { runPaymentReconciliation } from "./jobs/reconcilePayments.js";
import { expireBookingHolds } from "./jobs/expireBookingHolds.js";

const PORT = Number(process.env.PORT) || 3000;

const start = async () => {
  try {
    console.log("Connecting to database...");
    await ensureDatabase();

    console.log("Database loaded successfully.");

    // Only start Express after database is ready
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });


    if (process.env.NODE_ENV === "production") {
      console.log("Production jobs started.");

      setInterval(
        async () => {
          try {
            await runPaymentReconciliation();
          } catch (error) {
            console.error("Payment reconciliation failed:", error);
          }
        },
        5 * 60 * 1000,
      );

      setInterval(async () => {
        try {
          await expireBookingHolds();
        } catch (error) {
          console.error("Booking hold expiration failed:", error);
        }
      }, 60 * 1000);
    }
  } catch (error) {
    console.error("Database failed to load.");
    console.error(error);
    process.exit(1);
  }
};

start();
