import express from "express";
import helmet from "helmet";

import {
  env,
  isProduction
} from "../config/env.js";

import {
  naraCookieName,
  naraSession
} from "../sessions/sessions.js";

import {
  consumeTicket,
  isTicketCodeFormatValid
} from "../security/ticket.js";

import {
  createCsrfToken,
  verifyCsrf
} from "../security/csrf.js";

import {
  requirePageAuth,
  requireApiAuth
} from "../middleware/requireAuth.js";

import {
  findOwnerById
} from "../services/owner.service.js";

import {
  audit
} from "../services/audit.service.js";

import {
  aiRouter
} from "../routes/ai.routes.js";

const app = express();

if (isProduction) {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");

app.use(helmet());

app.use(
  express.json({
    limit: "1mb"
  })
);

app.use(
  express.urlencoded({
    extended: false,
    limit: "32kb"
  })
);

app.use(naraSession());

app.use(
  "/api/ai",
  aiRouter
);

function callbackUrl(): string {
  return `${env.PUBLIC_NARA_ORIGIN}/auth/callback`;
}

function setNoStore(
  res: express.Response
): void {
  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0"
  );

  res.setHeader(
    "Pragma",
    "no-cache"
  );

  res.setHeader(
    "Referrer-Policy",
    "no-referrer"
  );
}

function validOrigin(
  request: express.Request
): boolean {
  if (!isProduction) {
    return true;
  }

  const origin = request.get("origin");

  if (origin) {
    return origin === env.PUBLIC_NARA_ORIGIN;
  }

  const referer = request.get("referer");

  if (!referer) {
    return false;
  }

  try {
    return new URL(referer).origin ===
      env.PUBLIC_NARA_ORIGIN;
  } catch {
    return false;
  }
}

function escapeHtml(
  input: string
): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function regenerateSession(
  request: express.Request
): Promise<void> {
  return new Promise(
    (resolve, reject) => {
      request.session.regenerate(
        (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        }
      );
    }
  );
}

function saveSession(
  request: express.Request
): Promise<void> {
  return new Promise(
    (resolve, reject) => {
      request.session.save(
        (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        }
      );
    }
  );
}

function destroySession(
  request: express.Request
): Promise<void> {
  return new Promise((resolve) => {
    request.session.destroy(
      () => resolve()
    );
  });
}

app.get(
  "/health",
  (_req, res) => {
    res.json({
      ok: true,
      service: "nara-app"
    });
  }
);

app.get(
  "/auth/callback",
  async (req, res, next) => {
    try {
      setNoStore(res);

      const code =
        String(
          req.query.code ??
          ""
        );

      if (
        !isTicketCodeFormatValid(code)
      ) {
        return res
          .status(400)
          .send(
            "Login ticket tidak valid."
          );
      }

      const userId =
        await consumeTicket(
          code,
          "nara",
          callbackUrl()
        );

      if (!userId) {
        return res
          .status(401)
          .send(
            "Login ticket tidak valid atau sudah kedaluwarsa."
          );
      }

      const owner =
        await findOwnerById(
          userId
        );

      if (
        !owner ||
        !owner.is_active
      ) {
        return res
          .status(403)
          .send(
            "Owner account disabled."
          );
      }

      await regenerateSession(req);

      req.session.userId =
        owner.id;

      req.session.csrfToken =
        createCsrfToken();

      await saveSession(req);

      await audit({
        userId:
          owner.id,
        eventType:
          "NARA_SESSION_CREATED",
        request:
          req
      });

      return res.redirect(
        303,
        "/"
      );
    } catch (error) {
      next(error);
    }
  }
);

app.get(
  "/",
  requirePageAuth,
  async (req, res, next) => {
    try {
      setNoStore(res);

      const owner =
        await findOwnerById(
          req.session.userId!
        );

      if (!owner?.is_active) {
        await destroySession(req);

        return res.redirect(
          303,
          `${env.PUBLIC_AUTH_ORIGIN}/ownernara/login?return_to=${encodeURIComponent(callbackUrl())}`
        );
      }

      return res
        .status(200)
        .type("html")
        .send(`
<!doctype html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  >
  <meta
    name="robots"
    content="noindex,nofollow,noarchive"
  >
  <title>NARA</title>
</head>
<body>
  <h1>NARA ONLINE</h1>

  <p>
    Owner:
    ${escapeHtml(owner.display_name)}
  </p>

  <p>
    Authentication berhasil.
  </p>

  <p>
    AI, Avatar, Memory dan Google Drive
    akan dipasang pada layer ini.
  </p>
</body>
</html>
`);
    } catch (error) {
      next(error);
    }
  }
);

app.get(
  "/api/me",
  requireApiAuth,
  async (req, res, next) => {
    try {
      setNoStore(res);

      const owner =
        await findOwnerById(
          req.session.userId!
        );

      if (!owner?.is_active) {
        return res
          .status(401)
          .json({
            error:
              "AUTHENTICATION_REQUIRED"
          });
      }

      if (!req.session.csrfToken) {
        req.session.csrfToken =
          createCsrfToken();

        await saveSession(req);
      }

      return res.json({
        authenticated:
          true,

        displayName:
          owner.display_name,

        csrfToken:
          req.session.csrfToken
      });
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  "/logout",
  requireApiAuth,
  async (req, res, next) => {
    try {
      setNoStore(res);

      if (!validOrigin(req)) {
        return res
          .status(403)
          .json({
            error:
              "INVALID_ORIGIN"
          });
      }

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
        return res
          .status(403)
          .json({
            error:
              "INVALID_CSRF_TOKEN"
          });
      }

      const userId =
        req.session.userId;

      if (userId) {
        await audit({
          userId,
          eventType:
            "NARA_LOGOUT",
          request:
            req
        });
      }

      await destroySession(req);

      res.clearCookie(
        naraCookieName(),
        {
          httpOnly: true,
          secure: isProduction,
          sameSite: "lax",
          path: "/"
        }
      );

      return res
        .status(204)
        .end();
    } catch (error) {
      next(error);
    }
  }
);

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(
      "[NARA ERROR]",
      error
    );

    res
      .status(500)
      .json({
        error:
          "Internal server error"
      });
  }
);

app.listen(
  env.NARA_PORT,
  env.BIND_HOST,
  () => {
    console.log(
      `NARA Server running: ${env.PUBLIC_NARA_ORIGIN}`
    );
  }
);
