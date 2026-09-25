import {
  randomUUID
} from "node:crypto";

import express from "express";
import rateLimit from "express-rate-limit";

import {
  AiProviderError,
  type AiAttempt
} from "../ai/types.js";

import {
  AiChatSchema
} from "../ai/request.js";

import {
  AiGateway
} from "../ai/gateway.js";

import {
  OpenAiProvider
} from "../ai/providers/openai.provider.js";

import {
  GeminiProvider
} from "../ai/providers/gemini.provider.js";

import {
  AnthropicProvider
} from "../ai/providers/anthropic.provider.js";

import {
  OpenAiCompatibleProvider
} from "../ai/providers/openai-compatible.provider.js";

import {
  requireApiAuth
} from "../middleware/requireAuth.js";

import {
  requireCsrf
} from "../middleware/requireCsrf.js";

import {
  recordAiUsage
} from "../services/ai-usage.service.js";

const router =
  express.Router();

const gateway =
  new AiGateway([
    new OpenAiProvider(),
    new GeminiProvider(),
    new AnthropicProvider(),
    new OpenAiCompatibleProvider()
  ]);

const aiLimiter =
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
        "AI_RATE_LIMITED"
    }
  });

function publicError(
  error: unknown
): {
  code: string;
  status: number;
} {
  if (
    error instanceof
      AiProviderError
  ) {
    switch (
      error.code
    ) {
      case "AI_NO_PROVIDER":
        return {
          code:
            "AI_NO_PROVIDER",
          status:
            503
        };

      case "AI_PROVIDER_UNAVAILABLE":
        return {
          code:
            "AI_PROVIDER_UNAVAILABLE",
          status:
            503
        };

      case "AI_PROVIDER_CIRCUIT_OPEN":
        return {
          code:
            "AI_PROVIDER_CIRCUIT_OPEN",
          status:
            503
        };

      case "AI_NO_HEALTHY_PROVIDER":
        return {
          code:
            "AI_NO_HEALTHY_PROVIDER",
          status:
            503
        };

      case "AI_PROVIDER_TIMEOUT":
        return {
          code:
            "AI_PROVIDER_TIMEOUT",
          status:
            504
        };

      case "AI_GATEWAY_FAILED":
        return {
          code:
            "AI_GATEWAY_FAILED",
          status:
            502
        };

      default:
        break;
    }

    if (
      error.httpStatus ===
        408 ||
      error.httpStatus ===
        504
    ) {
      return {
        code:
          "AI_UPSTREAM_TIMEOUT",
        status:
          504
      };
    }

    if (
      error.httpStatus ===
        429
    ) {
      return {
        code:
          "AI_UPSTREAM_RATE_LIMITED",
        status:
          503
      };
    }

    if (
      error.httpStatus ===
        401 ||
      error.httpStatus ===
        403
    ) {
      return {
        code:
          "AI_UPSTREAM_AUTH_ERROR",
        status:
          502
      };
    }

    if (
      typeof error.httpStatus ===
        "number" &&
      error.httpStatus >=
        500
    ) {
      return {
        code:
          "AI_UPSTREAM_UNAVAILABLE",
        status:
          503
      };
    }

    return {
      code:
        error.retryable
          ? "AI_UPSTREAM_ERROR"
          : "AI_UPSTREAM_REJECTED",
      status:
        502
    };
  }

  return {
    code:
      "AI_GATEWAY_ERROR",

    status:
      500
  };
}
function noStore(
  res:
    express.Response
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

async function logAttempt(
  ownerId: string,
  requestId: string,
  attempt: AiAttempt
): Promise<void> {
  try {
    await recordAiUsage({
      ownerId,
      requestId,
      attempt
    });
  } catch (error) {
    console.error(
      "[AI USAGE LOG ERROR]",
      error
    );
  }
}

function writeSse(
  res: express.Response,
  event: string,
  data: unknown
): void {
  res.write(
    `event: ${event}\n`
  );

  res.write(
    `data: ${JSON.stringify(data)}\n\n`
  );
}

router.use(
  requireApiAuth
);

router.get(
  "/providers",
  (
    _req,
    res
  ) => {
    noStore(res);

    return res.json({
      providers:
        gateway.status()
    });
  }
);

router.post(
  "/chat",
  aiLimiter,
  requireCsrf,
  async (
    req,
    res,
    next
  ) => {
    try {
      noStore(res);

      const parsed =
        AiChatSchema.safeParse(
          req.body
        );

      if (!parsed.success) {
        return res
          .status(400)
          .json({
            error:
              "INVALID_AI_REQUEST"
          });
      }

      const requestId =
        randomUUID();

      const result =
        await gateway.generate(
          {
            message:
              parsed.data.message,

            history:
              parsed.data.history
          },
          {
            provider:
              parsed.data.provider,

            onAttempt:
              attempt =>
                logAttempt(
                  req.session
                    .userId!,
                  requestId,
                  attempt
                )
          }
        );

      return res.json({
        requestId,

        provider:
          result.provider,

        model:
          result.model,

        text:
          result.text,

        usage:
          result.usage,

        fallbackUsed:
          result.attempts.length >
          1
      });
    } catch (error) {
      const publicFailure =
        publicError(error);

      return res
        .status(
          publicFailure.status
        )
        .json({
          error:
            publicFailure.code
        });
    }
  }
);

router.post(
  "/stream",
  aiLimiter,
  requireCsrf,
  async (
    req,
    res
  ) => {
    noStore(res);

    const parsed =
      AiChatSchema.safeParse(
        req.body
      );

    if (!parsed.success) {
      return res
        .status(400)
        .json({
          error:
            "INVALID_AI_REQUEST"
        });
    }

    const requestId =
      randomUUID();

    const controller =
      new AbortController();

    const close =
      (): void => {
        controller.abort();
      };

    req.once(
      "aborted",
      close
    );

    res.once(
      "close",
      close
    );

    res.status(200);

    res.setHeader(
      "Content-Type",
      "text/event-stream; charset=utf-8"
    );

    res.setHeader(
      "Connection",
      "keep-alive"
    );

    res.setHeader(
      "X-Accel-Buffering",
      "no"
    );

    res.flushHeaders();

    writeSse(
      res,
      "request",
      {
        requestId
      }
    );

    try {
      const result =
        await gateway.stream(
          {
            message:
              parsed.data.message,

            history:
              parsed.data.history
          },
          {
            provider:
              parsed.data.provider,

            signal:
              controller.signal,

            onProvider:
              provider => {
                writeSse(
                  res,
                  "provider",
                  provider
                );
              },

            onDelta:
              delta => {
                writeSse(
                  res,
                  "delta",
                  {
                    text:
                      delta
                  }
                );
              },

            onAttempt:
              attempt =>
                logAttempt(
                  req.session
                    .userId!,
                  requestId,
                  attempt
                )
          }
        );

      writeSse(
        res,
        "done",
        {
          provider:
            result.completed
              .provider,

          model:
            result.completed
              .model,

          usage:
            result.completed
              .usage,

          fallbackUsed:
            result.attempts
              .length >
            1
        }
      );

      res.end();
    } catch (error) {
      if (
        controller.signal
          .aborted
      ) {
        return;
      }

      const publicFailure =
        publicError(error);

      writeSse(
        res,
        "error",
        {
          error:
            publicFailure.code
        }
      );

      res.end();
    } finally {
      req.off(
        "aborted",
        close
      );

      res.off(
        "close",
        close
      );
    }
  }
);

export {
  router as aiRouter
};
