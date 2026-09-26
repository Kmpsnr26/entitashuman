import {
  randomBytes,
  timingSafeEqual
} from "node:crypto";

export function createCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function verifyCsrf(
  expected: string | undefined,
  received: string | undefined
): boolean {
  if (!expected || !received) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(received, "utf8");

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}
