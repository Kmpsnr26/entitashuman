import type {
  Request,
  Response,
  NextFunction
} from "express";

import { env } from "../config/env.js";
import {
  findOwnerById
} from "../services/owner.service.js";

function authorizationUrl(): string {
  const callback =
    `${env.PUBLIC_ALECORE_AI_ORIGIN}/auth/callback`;

  const url = new URL(
    "/owner-alecore-ai/authorize",
    env.PUBLIC_AUTH_ORIGIN
  );

  url.searchParams.set(
    "return_to",
    callback
  );

  return url.toString();
}

async function destroySession(
  req: Request
): Promise<void> {
  await new Promise<void>((resolve) => {
    req.session.destroy(() => resolve());
  });
}

async function hasActiveOwner(
  req: Request
): Promise<boolean> {
  if (!req.session.userId) {
    return false;
  }

  const owner = await findOwnerById(
    req.session.userId
  );

  return Boolean(owner?.is_active);
}

export async function requirePageAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (await hasActiveOwner(req)) {
      next();
      return;
    }

    await destroySession(req);

    res.redirect(
      303,
      authorizationUrl()
    );
  } catch (error) {
    next(error);
  }
}

export async function requireApiAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (await hasActiveOwner(req)) {
      next();
      return;
    }

    await destroySession(req);

    res
      .status(401)
      .json({
        error: "AUTHENTICATION_REQUIRED",
        login: authorizationUrl()
      });
  } catch (error) {
    next(error);
  }
}
