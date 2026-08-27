export function notFoundHandler(req, res) {
  const isApiRequest = req.originalUrl.startsWith("/api") || req.accepts("json");

  if (isApiRequest) {
    return res.status(404).json({
      success: false,
      message: "Route not found.",
    });
  }

  return res.status(404).render("404", {
    flashMessages: [{ type: "error", text: "Page not found." }],
  });
}

export function appErrorHandler(err, req, res, next) {
  if (err?.code === "EBADCSRFTOKEN") {
    const isApiRequest = req.originalUrl.startsWith("/api") || req.accepts("json");

    if (isApiRequest) {
      return res.status(403).json({
        success: false,
        message: "Session expired. Please try again.",
      });
    }

    return res.status(403).render("403", {
      flashMessages: [{ type: "error", text: "Session expired. Please try again." }],
      googleEnabled: res.locals.googleEnabled,
    });
  }

  console.error("[AppError]", err);

  const isApiRequest = req.originalUrl.startsWith("/api") || req.accepts("json");
  if (isApiRequest) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: "Something went wrong. Please try again.",
    });
  }

  return res.status(500).render("500", {
    flashMessages: [{ type: "error", text: "Something went wrong. Please try again." }],
  });
}
