import type {
  NextFunction,
  Request,
  Response
} from "express";

import {
  verifyCsrf
} from "../security/csrf.js";

export function requireCsrf(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const received =
    req.get(
      "x-csrf-token"
    );

  if (
    !verifyCsrf(
      req.session.csrfToken,
      received
    )
  ) {
    res
      .status(403)
      .json({
        error:
          "INVALID_CSRF_TOKEN"
      });

    return;
  }

  next();
}
