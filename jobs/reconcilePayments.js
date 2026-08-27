import { reconcilePendingPayments } from "../services/reconciliationService.js";

export async function runPaymentReconciliation() {
  try {
    console.log("Running payment reconciliation...");

    await reconcilePendingPayments();

    console.log("Payment reconciliation complete.");
  } catch (error) {
    console.error("Payment reconciliation failed:", error);
  }
}
