import crypto from "crypto";

export function generatePaymentReference() {
  return `BKPAY-${Date.now()}-${crypto
    .randomBytes(5)
    .toString("hex")
    .toUpperCase()}`;
}
