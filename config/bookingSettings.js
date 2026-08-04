function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export const depositPercentage = 100;
export const remainingBalancePercentage = 0;
export const maxConcurrentBookingsPerSlot = parsePositiveInteger(process.env.MAX_CONCURRENT_BOOKINGS, 3);
export const maxHourlyBookingHours = parsePositiveInteger(process.env.MAX_HOURLY_BOOKING_HOURS, 12);