export function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }

  if (req.accepts("html") && !req.path.startsWith("/api")) {
    return res.redirect("/login");
  }

  return res.status(401).json({
    success: false,
    message: "Authentication required.",
  });
}

export function ensureAdmin(req, res, next) {
  if (
    req.isAuthenticated &&
    req.isAuthenticated() &&
    (req.user?.is_admin === true || req.user?.role === "admin")
  ) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: "Admin access is required.",
  });
}
