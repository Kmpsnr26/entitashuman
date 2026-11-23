import type {
  NextFunction,
  Request,
  Response
} from "express";

export function apiNoStore(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0"
  );

  res.setHeader(
    "Pragma",
    "no-cache"
  );

  next();
}
