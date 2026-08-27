import db from "../config/db.js";

export async function expireBookingHolds() {
  try {
    const result = await db.query(
      `
          UPDATE booking_holds
          SET
            status = 'expired',
            updated_at = NOW()
          WHERE
            status = 'active'
            AND expires_at <= NOW()
          RETURNING id
        `,
    );

    if (result.rowCount > 0) {
      console.log(`⏱️ Expired ${result.rowCount} booking hold(s).`);
    }
  } catch (error) {
    console.error("Failed to expire booking holds:", error);
  }
}
