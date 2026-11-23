import express from "express";
import { bodyParserError } from "../middleware/bodyParserError.js";
import { isTrustedRequestOrigin } from "../security/origin.js";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import {
  env,
  isProduction
} from "../config/env.js";

import {
  ownerCookieName,
  ownerSsoSession
} from "../sessions/sessions.js";

import {
  createCsrfToken,
  verifyCsrf
} from "../security/csrf.js";

import {
  issueTicket
} from "../security/ticket.js";

import {
  verifyPassword
} from "../security/password.js";

import {
  findOwnerByEmail,
  findOwnerById,
  updateLastLogin
} from "../services/owner.service.js";

import {
  audit
} from "../services/audit.service.js";

const app = express();

if (isProduction) {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");

app.use(helmet());

app.use(
  express.urlencoded({
    extended: false,
    limit: "16kb"
  })
);

app.use(
  express.json({
    limit: "16kb"
  })
);

app.use(ownerSsoSession());

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message:
    "Terlalu banyak percobaan login. Silakan coba lagi."
});

const LoginSchema = z.object({
  email: z
    .string()
    .email()
    .max(254),

  password: z
    .string()
    .min(8)
    .max(256),

  csrf_token: z
    .string()
    .min(20)
    .max(200),

  return_to: z
    .string()
    .url()
});

function callbackUrl(): string {
  return `${env.PUBLIC_ALECORE_AI_ORIGIN}/auth/callback`;
}

function validateReturnTo(
  value: string
): string {
  if (value !== callbackUrl()) {
    throw new Error("Invalid callback URL");
  }

  return value;
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
  return isTrustedRequestOrigin({
    origin: request.get("origin"),
    referer: request.get("referer"),
    secFetchSite: request.get("sec-fetch-site")
  }, env.PUBLIC_AUTH_ORIGIN, isProduction);
}

function loginPage(
  csrfToken: string,
  returnTo: string,
  error?: string
): string {
  const safeError = error
    ? `<p role="alert">${escapeHtml(error)}</p>`
    : "";

  return `
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
  <title>AleCore AI Owner Login</title>
</head>
<body>
<main>
  <h1>AleCore AI</h1>
  <p>OWNER ACCESS</p>

  ${safeError}

  <form
    method="POST"
    action="/ownernara/login"
  >
    <input
      type="hidden"
      name="csrf_token"
      value="${escapeHtml(csrfToken)}"
    >

    <input
      type="hidden"
      name="return_to"
      value="${escapeHtml(returnTo)}"
    >

    <label>
      Email
      <input
        name="email"
        type="email"
        autocomplete="username"
        maxlength="254"
        required
      >
    </label>

    <br><br>

    <label>
      Password
      <input
        name="password"
        type="password"
        autocomplete="current-password"
        maxlength="256"
        required
      >
    </label>

    <br><br>

    <button type="submit">
      Masuk ke AleCore AI
    </button>
  </form>
</main>
</body>
</html>
`;
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

function loginRedirect(
  returnTo: string
): string {
  const loginUrl = new URL(
    "/ownernara/login",
    env.PUBLIC_AUTH_ORIGIN
  );

  loginUrl.searchParams.set(
    "return_to",
    returnTo
  );

  return loginUrl.toString();
}

app.get(
  "/health",
  (_req, res) => {
    res.json({
      ok: true,
      service: "alecore-ai-auth"
    });
  }
);

app.get(
  "/ownernara/authorize",
  async (req, res, next) => {
    try {
      setNoStore(res);

      const returnTo = validateReturnTo(
        String(
          req.query.return_to ??
          ""
        )
      );

      if (!req.session.userId) {
        return res.redirect(
          303,
          loginRedirect(returnTo)
        );
      }

      const owner = await findOwnerById(
        req.session.userId
      );

      if (!owner?.is_active) {
        await destroySession(req);

        return res.redirect(
          303,
          loginRedirect(returnTo)
        );
      }

      const ticket = await issueTicket(
        owner.id,
        "nara",
        returnTo
      );

      await audit({
        userId: owner.id,
        eventType: "SSO_TICKET_ISSUED",
        request: req,
        metadata: {
          audience: "nara"
        }
      });

      const destination =
        new URL(returnTo);

      destination.searchParams.set(
        "code",
        ticket
      );

      return res.redirect(
        303,
        destination.toString()
      );
    } catch (error) {
      next(error);
    }
  }
);

app.get(
  "/ownernara/login",
  async (req, res, next) => {
    try {
      setNoStore(res);

      const returnTo = validateReturnTo(
        String(
          req.query.return_to ??
          callbackUrl()
        )
      );

      if (req.session.userId) {
        const owner = await findOwnerById(
          req.session.userId
        );

        if (owner?.is_active) {
          const authorize =
            new URL(
              "/ownernara/authorize",
              env.PUBLIC_AUTH_ORIGIN
            );

          authorize.searchParams.set(
            "return_to",
            returnTo
          );

          return res.redirect(
            303,
            authorize.toString()
          );
        }

        await destroySession(req);
      }

      const csrfToken =
        createCsrfToken();

      req.session.csrfToken =
        csrfToken;

      await saveSession(req);

      return res
        .status(200)
        .type("html")
        .send(
          loginPage(
            csrfToken,
            returnTo
          )
        );
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  "/ownernara/login",
  loginLimiter,
  async (req, res, next) => {
    try {
      setNoStore(res);

      if (!validOrigin(req)) {
        return res
          .status(403)
          .send(
            "Invalid request origin."
          );
      }

      const parsed =
        LoginSchema.safeParse(
          req.body
        );

      if (!parsed.success) {
        return res
          .status(400)
          .send(
            "Data login tidak valid."
          );
      }

      const {
        email,
        password,
        csrf_token,
        return_to
      } = parsed.data;

      const returnTo =
        validateReturnTo(return_to);

      if (
        !verifyCsrf(
          req.session.csrfToken,
          csrf_token
        )
      ) {
        return res
          .status(403)
          .send(
            "Security token tidak valid."
          );
      }

      const owner =
        await findOwnerByEmail(email);

      /*
       * Selalu lakukan Argon2 verification.
       * Jika email tidak ada, verifyPassword()
       * menggunakan dummy Argon2id hash.
       */
      const validPassword =
        await verifyPassword(
          owner?.password_hash,
          password
        );

      if (
        !owner ||
        !owner.is_active ||
        !validPassword
      ) {
        await audit({
          eventType:
            "LOGIN_FAILED",
          request: req
        });

        const csrf =
          createCsrfToken();

        req.session.csrfToken =
          csrf;

        await saveSession(req);

        return res
          .status(401)
          .type("html")
          .send(
            loginPage(
              csrf,
              returnTo,
              "Email atau password salah."
            )
          );
      }

      await regenerateSession(req);

      req.session.userId =
        owner.id;

      req.session.csrfToken =
        createCsrfToken();

      await saveSession(req);

      await updateLastLogin(
        owner.id
      );

      await audit({
        userId:
          owner.id,
        eventType:
          "LOGIN_SUCCESS",
        request:
          req
      });

      const ticket =
        await issueTicket(
          owner.id,
          "nara",
          returnTo
        );

      const destination =
        new URL(returnTo);

      destination.searchParams.set(
        "code",
        ticket
      );

      return res.redirect(
        303,
        destination.toString()
      );
    } catch (error) {
      next(error);
    }
  }
);

app.get(
  "/ownernara/session",
  async (req, res, next) => {
    try {
      setNoStore(res);

      if (!req.session.userId) {
        return res.json({
          authenticated: false
        });
      }

      const owner =
        await findOwnerById(
          req.session.userId
        );

      if (!owner?.is_active) {
        await destroySession(req);

        return res.json({
          authenticated: false
        });
      }

      if (!req.session.csrfToken) {
        req.session.csrfToken =
          createCsrfToken();

        await saveSession(req);
      }

      return res.json({
        authenticated: true,
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
  "/ownernara/logout",
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
        req.get("x-csrf-token") ??
        (
          typeof req.body?.csrf_token ===
          "string"
            ? req.body.csrf_token
            : undefined
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
            "AUTH_LOGOUT",
          request:
            req
        });
      }

      await destroySession(req);

      res.clearCookie(
        ownerCookieName(),
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
      "[AUTH ERROR]",
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
  env.AUTH_PORT,
  env.BIND_HOST,
  () => {
    console.log(
      `AleCore AI Auth Server running: ${env.PUBLIC_AUTH_ORIGIN}`
    );
  }
);
