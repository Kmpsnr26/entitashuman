import type { ErrorRequestHandler } from "express";

// Parser errors contain the submitted body. Return only an owned error code
// before the generic logger can record that potentially sensitive content.
export const bodyParserError: ErrorRequestHandler = (error, _req, res, next) => {
  if (error?.type === "entity.parse.failed" && error?.status === 400) {
    res.status(400).json({ error: "INVALID_JSON" });
    return;
  }
  if (error?.type === "entity.too.large" && error?.status === 413) {
    res.status(413).json({ error: "REQUEST_BODY_TOO_LARGE" });
    return;
  }
  next(error);
};
