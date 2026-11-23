import type {
  NextFunction,
  Request,
  Response
} from "express";

export function requireJsonContentType(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const contentType =
    req.is([
      "application/json",
      "application/*+json"
    ]);

  if (!contentType) {
    res
      .status(415)
      .json({
        error:
          "JSON_CONTENT_TYPE_REQUIRED"
      });

    return;
  }

  next();
}
