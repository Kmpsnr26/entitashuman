export interface RequestOriginHeaders {
  origin?: string;
  referer?: string;
  secFetchSite?: string;
}

export function isTrustedRequestOrigin(
  headers: RequestOriginHeaders,
  expectedOrigin: string,
  enforce: boolean
): boolean {
  if (
    headers.secFetchSite
      ?.trim()
      .toLowerCase() ===
    "cross-site"
  ) {
    return false;
  }

  const origin =
    headers.origin
      ?.trim();

  if (origin) {
    return (
      origin ===
      expectedOrigin
    );
  }

  const referer =
    headers.referer
      ?.trim();

  if (!referer) {
    return !enforce;
  }

  try {
    return (
      new URL(
        referer
      ).origin ===
      expectedOrigin
    );
  } catch {
    return false;
  }
}
