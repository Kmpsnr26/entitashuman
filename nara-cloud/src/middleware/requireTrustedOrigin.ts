import type {
  NextFunction,
  Request,
  Response
} from "express";

import {
  env,
  isProduction
} from "../config/env.js";

import {
  isTrustedRequestOrigin
} from "../security/origin.js";

export function requireTrustedOrigin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const trusted =
    isTrustedRequestOrigin(
      {
        origin:
          req.get(
            "origin"
          ) ??
          undefined,

        referer:
          req.get(
            "referer"
          ) ??
          undefined,

        secFetchSite:
          req.get(
            "sec-fetch-site"
          ) ??
          undefined
      },
      env.PUBLIC_NARA_ORIGIN,
      isProduction
    );

  if (!trusted) {
    res
      .status(403)
      .json({
        error:
          "INVALID_ORIGIN"
      });

    return;
  }

  next();
}
