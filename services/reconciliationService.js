// api/services/reconciliationService.js

import db from "../config/db.js";

import { verifyPaystackTransaction } from "./paymentService.js";

import { processSuccessfulPayment } from "./paymentService.js";

export async function reconcilePendingPayments() {
  const result = await db.query(
    `
        SELECT *
        FROM payments
        WHERE
          (
            status = 'pending'
            OR reconciliation_status = 'pending'
          )
          AND created_at >
              NOW() - INTERVAL '24 hours'
        ORDER BY created_at ASC
        LIMIT 100
      `,
  );

  for (const payment of result.rows) {
    try {
      await db.query(
        `
          UPDATE payments
          SET
            reconciliation_status =
              'processing',

            reconciliation_attempts =
              reconciliation_attempts + 1,

            last_reconciliation_at =
              NOW(),

            updated_at = NOW()

          WHERE id = $1
        `,
        [payment.id],
      );

      const transaction = await verifyPaystackTransaction(
        payment.payment_reference,
      );

      /*
       * Payment did NOT succeed.
       */

      if (transaction.status !== "success") {
        await db.query(
          `
            UPDATE payments
            SET
              reconciliation_status =
                'not_required',

              updated_at = NOW()

            WHERE id = $1
          `,
          [payment.id],
        );

        continue;
      }

      /*
       * Amount must still match.
       */

      if (Number(transaction.amount) !== Number(payment.amount) * 100) {
        await db.query(
          `
            UPDATE payments
            SET
              reconciliation_status =
                'manual_review',

              updated_at = NOW()

            WHERE id = $1
          `,
          [payment.id],
        );

        continue;
      }

      /*
       * Now safely run the exact same
       * idempotent payment confirmation
       * process.
       */

      await processSuccessfulPayment(payment.payment_reference);

      await db.query(
        `
          UPDATE payments
          SET
            reconciliation_status =
              'reconciled',

            updated_at = NOW()

          WHERE id = $1
        `,
        [payment.id],
      );
    } catch (error) {
      console.error(
        `Reconciliation failed for ${payment.payment_reference}:`,
        error.message,
      );

      await db.query(
        `
          UPDATE payments
          SET
            reconciliation_status =
              CASE
                WHEN reconciliation_attempts >= 5
                  THEN 'manual_review'
                ELSE 'pending'
              END,

            updated_at = NOW()

          WHERE id = $1
        `,
        [payment.id],
      );
    }
  }
}
