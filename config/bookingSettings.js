function parsePositiveInteger(name) {
  const value = process.env[name];
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer.`);
  }
  return parsed;
}

export const depositPercentage = 100;
export const remainingBalancePercentage = 0;
export const maxConcurrentBookingsPerSlot = parsePositiveInteger("MAX_CONCURRENT_BOOKINGS");
export const maxHourlyBookingHours = parsePositiveInteger("MAX_HOURLY_BOOKING_HOURS");