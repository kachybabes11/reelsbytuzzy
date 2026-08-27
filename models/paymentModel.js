export async function createPayment(client, data) {
  const result = await client.query(
    `
      INSERT INTO payments (
        hold_token,
        payment_reference,
        amount,
        currency,
        status,
        metadata
      )
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
    `,
    [
      data.holdToken,
      data.paymentReference,
      data.amount,
      data.currency,
      data.status || "pending",
      JSON.stringify(data.metadata || {}),
    ],
  );

  return result.rows[0];
}

export async function findPaymentByReference(client, reference) {
  const result = await client.query(
    `
      SELECT *
      FROM payments
      WHERE payment_reference = $1
      LIMIT 1
    `,
    [reference],
  );

  return result.rows[0] || null;
}

export async function markPaymentSuccessful(
  client,
  { reference, transactionId, gatewayResponse, channel },
) {
  const result = await client.query(
    `
      UPDATE payments
      SET
        status = 'successful',
        paystack_transaction_id = $1,
        gateway_response = $2,
        channel = $3,
        paid_at = NOW(),
        verified_at = NOW(),
        updated_at = NOW()
      WHERE payment_reference = $4
        AND status != 'successful'
      RETURNING *
    `,
    [transactionId, gatewayResponse || null, channel || null, reference],
  );

  return result.rows[0] || null;
}

export async function markWebhookReceived(client, reference) {
  await client.query(
    `
      UPDATE payments
      SET
        webhook_received_at = NOW(),
        updated_at = NOW()
      WHERE payment_reference = $1
    `,
    [reference],
  );
}
