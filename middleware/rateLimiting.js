const attemptsByIp = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 30;

setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of attemptsByIp.entries()) {
    if (now - data.firstSeen > WINDOW_MS) {
      attemptsByIp.delete(ip);
    }
  }
}, 60 * 1000).unref();

export default function authLimiter(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const current = attemptsByIp.get(ip);

  if (!current || now - current.firstSeen > WINDOW_MS) {
    attemptsByIp.set(ip, { count: 1, firstSeen: now });
    return next();
  }

  current.count += 1;
  if (current.count > MAX_ATTEMPTS) {
    const isApiRequest = req.originalUrl.startsWith("/api") || req.accepts("json");

    if (isApiRequest) {
      return res.status(429).json({
        success: false,
        message: "Too many attempts. Please try again later.",
      });
    }

    return res.status(429).render("login", {
      flashMessages: [{ type: "error", text: "Too many attempts. Please try again later." }],
      googleEnabled: res.locals.googleEnabled,
    });
  }

  return next();
}
