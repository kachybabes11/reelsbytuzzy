export function requireEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function requirePositiveIntegerEnv(name) {
  const rawValue = process.env[name];
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer.`);
  }
  return parsed;
}
