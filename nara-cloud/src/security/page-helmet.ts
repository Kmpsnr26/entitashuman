import helmet from "helmet";

/** Keep local HTTP assets usable; deployed production still requires HTTPS. */
export function pageHelmet(production: boolean, ssoReturnOrigin?: string) {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        "upgrade-insecure-requests": production ? [] : null,
        "form-action": ["'self'", ...(ssoReturnOrigin ? [ssoReturnOrigin] : [])]
      }
    }
  });
}
