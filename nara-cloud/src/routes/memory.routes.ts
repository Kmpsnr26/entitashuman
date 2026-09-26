import express from "express";
import { z } from "zod";

import {
  createMemory,
  deleteMemory,
  findMemory,
  listMemory,
  MemoryRelationError
} from "../services/memory.service.js";

import {
  requireApiAuth
} from "../middleware/requireAuth.js";

import {
  requireCsrf
} from "../middleware/requireCsrf.js";

const router =
  express.Router();

const MemoryScopeSchema =
  z.enum([
    "short_term",
    "long_term",
    "project",
    "conversation"
  ]);

const MemoryCreateSchema =
  z.object({
    scope:
      MemoryScopeSchema,

    title:
      z.string()
        .trim()
        .min(1)
        .max(160),

    content:
      z.string()
        .min(1)
        .max(100_000),

    tags:
      z.array(
        z.string()
          .trim()
          .min(1)
          .max(64)
      )
        .max(32)
        .default([]),

    importance:
      z.number()
        .int()
        .min(1)
        .max(5)
        .default(1),

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
      (value, ctx) => {
        if (
          value.scope === "project" &&
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
          value.scope === "conversation" &&
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

const MemoryListQuerySchema =
  z.object({
    scope:
      MemoryScopeSchema
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
        .optional(),

    limit:
      z.coerce
        .number()
        .int()
        .min(1)
        .max(50)
        .default(20)
  });

const MemoryIdSchema =
  z.string()
    .uuid();

function noStore(
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
}

router.use(
  requireApiAuth
);

router.get(
  "/",
  async (
    req,
    res,
    next
  ) => {
    try {
      noStore(res);

      const parsed =
        MemoryListQuerySchema
          .safeParse({
            scope:
              req.query.scope,
            projectKey:
              req.query.projectKey,
            conversationId:
              req.query.conversationId,
            limit:
              req.query.limit ??
              20
          });

      if (!parsed.success) {
        return res
          .status(400)
          .json({
            error:
              "INVALID_MEMORY_QUERY"
          });
      }

      const memories =
        await listMemory({
          ownerId:
            req.session
              .userId!,
          ...parsed.data
        });

      return res.json({
        memories
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/:id",
  async (
    req,
    res,
    next
  ) => {
    try {
      noStore(res);

      const parsedId =
        MemoryIdSchema
          .safeParse(
            req.params.id
          );

      if (!parsedId.success) {
        return res
          .status(400)
          .json({
            error:
              "INVALID_MEMORY_ID"
          });
      }

      const memory =
        await findMemory(
          req.session.userId!,
          parsedId.data
        );

      if (!memory) {
        return res
          .status(404)
          .json({
            error:
              "MEMORY_NOT_FOUND"
          });
      }

      return res.json({
        memory
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/",
  requireCsrf,
  async (
    req,
    res,
    next
  ) => {
    try {
      noStore(res);

      const parsed =
        MemoryCreateSchema
          .safeParse(
            req.body
          );

      if (!parsed.success) {
        return res
          .status(400)
          .json({
            error:
              "INVALID_MEMORY_REQUEST"
          });
      }

      const memory =
        await createMemory({
          ownerId:
            req.session
              .userId!,
          ...parsed.data
        });

      return res
        .status(201)
        .json({
          memory
        });
    } catch (error) {
      if (
        error instanceof
          MemoryRelationError
      ) {
        return res
          .status(400)
          .json({
            error:
              "INVALID_MEMORY_RELATION"
          });
      }

      next(error);
    }
  }
);

router.delete(
  "/:id",
  requireCsrf,
  async (
    req,
    res,
    next
  ) => {
    try {
      noStore(res);

      const parsedId =
        MemoryIdSchema
          .safeParse(
            req.params.id
          );

      if (!parsedId.success) {
        return res
          .status(400)
          .json({
            error:
              "INVALID_MEMORY_ID"
          });
      }

      const deleted =
        await deleteMemory(
          req.session.userId!,
          parsedId.data
        );

      if (!deleted) {
        return res
          .status(404)
          .json({
            error:
              "MEMORY_NOT_FOUND"
          });
      }

      return res
        .status(204)
        .end();
    } catch (error) {
      next(error);
    }
  }
);

export {
  router as memoryRouter
};
