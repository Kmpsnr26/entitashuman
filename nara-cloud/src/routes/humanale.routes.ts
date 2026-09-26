import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import {
  requireApiAuth
} from "../middleware/requireAuth.js";

import {
  requireTrustedOrigin
} from "../middleware/requireTrustedOrigin.js";

import {
  requireJsonContentType
} from "../middleware/requireJsonContentType.js";

import {
  requireCsrf
} from "../middleware/requireCsrf.js";

import {
  audit
} from "../services/audit.service.js";

import {
  createHumanALECloudContext
} from "../services/humanale-cloud.service.js";

import {
  MAX_CONTEXT_CHARS,
  MAX_CONTEXT_ENTRIES
} from "../humanale/context-packet.js";

const router =
  express.Router();

const bridgeLimiter =
  rateLimit({
    windowMs:
      60 * 1000,

    limit:
      30,

    standardHeaders:
      true,

    legacyHeaders:
      false,

    message: {
      error:
        "HUMANALE_BRIDGE_RATE_LIMITED"
    }
  });

const ContextRequestSchema =
  z.object({
    target:
      z.enum([
        "reasoner",
        "planner",
        "agent"
      ]),

    mode:
      z.enum([
        "ask",
        "auto-safe"
      ]),

    approved:
      z.boolean()
        .default(false),

    scope:
      z.enum([
        "short_term",
        "long_term",
        "project",
        "conversation"
      ])
        .optional(),

    projectKey:
      z.string()
        .trim()
        .min(1)
        .max(120)
        .optional(),

    conversationId:
      z.string()
        .uuid()
        .optional()
  })
    .superRefine(
      (
        value,
        ctx
      ) => {
        if (
          value.scope ===
            "project" &&
          !value.projectKey
        ) {
          ctx.addIssue({
            code:
              z.ZodIssueCode.custom,
            path:
              ["projectKey"],
            message:
              "projectKey is required for project scope"
          });
        }

        if (
          value.scope ===
            "conversation" &&
          !value.conversationId
        ) {
          ctx.addIssue({
            code:
              z.ZodIssueCode.custom,
            path:
              ["conversationId"],
            message:
              "conversationId is required for conversation scope"
          });
        }
      }
    );

router.use(
  requireApiAuth
);

router.get(
  "/status",
  (
    _req,
    res
  ) => {
    return res.json({
      available:
        true,

      version:
        1,

      targets: [
        "reasoner",
        "planner",
        "agent"
      ],

      modes: [
        "ask",
        "auto-safe"
      ],

      maxEntries:
        MAX_CONTEXT_ENTRIES,

      maxChars:
        MAX_CONTEXT_CHARS
    });
  }
);

router.post(
  "/context",
  bridgeLimiter,
  requireTrustedOrigin,
  requireJsonContentType,
  requireCsrf,
  async (
    req,
    res,
    next
  ) => {
    try {
      const parsed =
        ContextRequestSchema
          .safeParse(
            req.body
          );

      if (!parsed.success) {
        return res
          .status(400)
          .json({
            error:
              "INVALID_HUMANALE_CONTEXT_REQUEST"
          });
      }

      if (
        parsed.data.mode ===
          "ask" &&
        parsed.data.approved !==
          true
      ) {
        return res
          .status(409)
          .json({
            error:
              "HUMANALE_CONTEXT_APPROVAL_REQUIRED"
          });
      }

      const context =
        await createHumanALECloudContext({
          ownerId:
            req.session
              .userId!,

          target:
            parsed.data.target,

          mode:
            parsed.data.mode,

          scope:
            parsed.data.scope,

          projectKey:
            parsed.data.projectKey,

          conversationId:
            parsed.data
              .conversationId
        });

      if (context) {
        await audit({
          userId:
            req.session
              .userId!,
          eventType:
            "NARA_HUMANALE_CONTEXT_GRANTED",
          request:
            req,
          metadata: {
            target:
              context.target,
            mode:
              context.mode,
            count:
              context.count,
            chars:
              context.chars
          }
        });
      }

      return res.json({
        context
      });
    } catch (error) {
      next(error);
    }
  }
);

export {
  router as humanaleRouter
};
