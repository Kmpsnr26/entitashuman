import session from "express-session";
import connectPgSimple from "connect-pg-simple";

import { pool } from "../db/pool.js";
import {
  env,
  isProduction
} from "../config/env.js";

const PgStore = connectPgSimple(session);

export function ownerCookieName(): string {
  return isProduction
    ? "__Host-owner_sso"
    : "owner_sso_dev";
}

export function aleCookieName(): string {
  return isProduction
    ? "__Host-ale_session"
    : "ale_session_dev";
}

export function ownerSsoSession() {
  return session({
    name: ownerCookieName(),

    store: new PgStore({
      pool,
      tableName: "owner_auth_sessions",
      createTableIfMissing: false
    }),

    secret: env.AUTH_SESSION_SECRET,

    resave: false,
    saveUninitialized: false,

    rolling: false,
    proxy: isProduction,

    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/",
      maxAge: 1000 * 60 * 60 * 12
    }
  });
}

export function aleSession() {
  return session({
    name: aleCookieName(),

    store: new PgStore({
      pool,
      tableName: "alecore_ai_app_sessions",
      createTableIfMissing: false
    }),

    secret: env.ALECORE_AI_SESSION_SECRET,

    resave: false,
    saveUninitialized: false,

    rolling: true,
    proxy: isProduction,

    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/",
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  });
}
