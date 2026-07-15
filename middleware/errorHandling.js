export function notFoundHandler(req, res) {
	res.status(404).render("404", {
		flashMessages: [{ type: "error", text: "Page not found." }],
	});
}

export function appErrorHandler(err, req, res, next) {
	if (err?.code === "EBADCSRFTOKEN") {
		return res.status(403).render("403", {
			flashMessages: [{ type: "error", text: "Session expired. Please try again." }],
			googleEnabled: res.locals.googleEnabled,
		});
	}

	console.error("[AppError]", err);
	return res.status(500).render("500", {
		flashMessages: [{ type: "error", text: "Something went wrong. Please try again." }],
	});
}
