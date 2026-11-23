import express from "express";
import { bodyParserError } from "../middleware/bodyParserError.js";
import { pageHelmet } from "../security/page-helmet.js";

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
  createCsrfToken
} from "../security/csrf.js";

import {
  requirePageAuth,
  requireApiAuth
} from "../middleware/requireAuth.js";

import {
  requireCsrf
} from "../middleware/requireCsrf.js";

import {
  requireTrustedOrigin
} from "../middleware/requireTrustedOrigin.js";

import {
  apiNoStore
} from "../middleware/apiNoStore.js";

import {
  findOwnerById
} from "../services/owner.service.js";

import {
  audit
} from "../services/audit.service.js";

import {
  aiRouter
} from "../routes/ai.routes.js";

import {
  memoryRouter
} from "../routes/memory.routes.js";

import {
  backupRouter
} from "../routes/backup.routes.js";

import {
  humanaleRouter
} from "../routes/humanale.routes.js";

import {
  mobileConsoleHtml,
  mobileConsoleCss,
  mobileConsoleScript
} from "../web/mobile-console.js";

const app = express();

if (isProduction) {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");

app.use(pageHelmet(isProduction));

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
  "/api",
  apiNoStore
);

app.use(
  "/api/ai",
  aiRouter
);

app.use(
  "/api/memory",
  memoryRouter
);

app.use(
  "/api/backups",
  backupRouter
);

app.use(
  "/api/humanale",
  humanaleRouter
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
        .send(mobileConsoleHtml);
    } catch (error) {
      next(error);
    }
  }
);

app.get(
  "/mobile-console.js",
  requirePageAuth,
  (_req, res) => {
    setNoStore(res);
    res.type("application/javascript").send(mobileConsoleScript());
  }
);

app.get(
  "/mobile-console.css",
  requirePageAuth,
  (_req, res) => {
    setNoStore(res);
    res.type("text/css").send(mobileConsoleCss);
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
  requireTrustedOrigin,
  requireCsrf,
  async (req, res, next) => {
    try {
      setNoStore(res);

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

app.use(bodyParserError);

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
