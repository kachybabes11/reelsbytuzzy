import crypto from "crypto";

export function generateBookingReference() {
  return `BK-${Date.now()}-${crypto
    .randomBytes(4)
    .toString("hex")
    .toUpperCase()}`;
}
