export { ensureAuthenticated, ensureAdmin } from "./authMiddleware.js";
export default function ensureMiddleware(req, res, next) {
  return ensureAuthenticated(req, res, next);
}
