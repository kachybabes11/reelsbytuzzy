export function notFoundHandler(req, res) {
  const isApiRequest = req.path.startsWith("/api");

  if (isApiRequest) {
    return res.status(404).json({
      success: false,
      message: "Route not found.",
    });
  }

  return res.status(404).render("errors/404", {
    title: "Page not found",
    message: "The page you requested could not be found.",
  });
}

export function appErrorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  if (err?.code === "EBADCSRFTOKEN") {
    const isApiRequest = req.path.startsWith("/api");

    if (isApiRequest) {
      return res.status(403).json({
        success: false,
        message: "Session expired. Please try again.",
      });
    }

    return res.status(403).render("errors/403", {
      title: "Session expired",
      message: "Your session expired. Please try again.",
    });
  }

  console.error("[AppError]", err);

  const isApiRequest = req.path.startsWith("/api");
  if (isApiRequest) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: "Something went wrong. Please try again.",
    });
  }

  return res.status(500).render("errors/500", {
    title: "Something went wrong",
    message: "Something went wrong. Please try again.",
  });
}
