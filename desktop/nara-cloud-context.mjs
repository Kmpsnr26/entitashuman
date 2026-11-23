const TARGETS =
  new Set([
    "reasoner",
    "planner",
    "agent"
  ]);

const MODES =
  new Set([
    "ask",
    "auto-safe"
  ]);

function normalizeOrigin(
  value
) {
  const raw =
    String(
      value ??
      ""
    ).trim();

  if (!raw) {
    return "";
  }

  const url =
    new URL(raw);

  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !==
      "/"
  ) {
    throw new Error(
      "NARA_CLOUD_ORIGIN harus berupa origin tanpa credential/path/query/hash."
    );
  }

  const local =
    (
      url.hostname ===
        "127.0.0.1" ||
      url.hostname ===
        "localhost" ||
      url.hostname ===
        "::1"
    );

  if (
    url.protocol !==
      "https:" &&
    !(
      local &&
      url.protocol ===
        "http:"
    )
  ) {
    throw new Error(
      "NARA_CLOUD_ORIGIN wajib HTTPS kecuali loopback lokal."
    );
  }

  return url.origin;
}

function safePreview(
  value,
  target,
  mode
) {
  if (
    !value ||
    typeof value !==
      "object" ||
    value.version !==
      1 ||
    value.approved !==
      false ||
    value.target !==
      target ||
    value.mode !==
      mode ||
    !Number.isInteger(
      value.count
    ) ||
    value.count < 1 ||
    value.count > 6 ||
    !Number.isInteger(
      value.chars
    ) ||
    value.chars < 1 ||
    value.chars > 1600 ||
    typeof value.text !==
      "string" ||
    value.text.length !==
      value.chars ||
    !Array.isArray(
      value.entryIds
    ) ||
    value.entryIds.length !==
      value.count ||
    new Set(
      value.entryIds
    ).size !==
      value.count ||
    value.entryIds.some(
      id =>
        typeof id !==
          "string" ||
        !/^[a-f0-9-]{36}$/i
          .test(id)
    )
  ) {
    throw new Error(
      "Preview AleCore Cloud tidak valid."
    );
  }

  return Object.freeze({
    version:
      1,
    target,
    mode,
    approved:
      false,
    count:
      value.count,
    chars:
      value.chars,
    entryIds:
      Object.freeze(
        [
          ...value.entryIds
        ]
      ),
    text:
      value.text
  });
}

export class NaraCloudContextClient {
  constructor({
    origin,
    fetchImpl,
    validateMemoryContext
  } = {}) {
    this.origin =
      normalizeOrigin(
        origin
      );

    this.fetch =
      fetchImpl;

    this.validate =
      validateMemoryContext;

    this.csrfToken =
      "";

    if (
      this.origin &&
      typeof this.fetch !==
        "function"
    ) {
      throw new Error(
        "fetchImpl wajib tersedia untuk AleCore Cloud."
      );
    }

    if (
      this.origin &&
      typeof this.validate !==
        "function"
    ) {
      throw new Error(
        "Validator memory context wajib tersedia."
      );
    }
  }

  configured() {
    return Boolean(
      this.origin
    );
  }

  loginUrl() {
    return this.origin
      ? this.origin + "/"
      : "";
  }

  async request(
    path,
    init = {}
  ) {
    const response =
      await this.fetch(
        this.origin +
        path,
        {
          ...init,
          credentials:
            "include",
          signal:
            AbortSignal.timeout(
              15_000
            )
        }
      );

    return response;
  }

  async status() {
    if (
      !this.configured()
    ) {
      return {
        configured:
          false,
        authenticated:
          false,
        available:
          false
      };
    }

    let me;

    try {
      me =
        await this.request(
          "/api/me",
          {
            method:
              "GET",
            headers: {
              Accept:
                "application/json"
            }
          }
        );
    } catch {
      return {
        configured:
          true,
        authenticated:
          false,
        available:
          false,
        error:
          "NARA_CLOUD_UNREACHABLE"
      };
    }

    if (
      me.status ===
        401
    ) {
      this.csrfToken =
        "";

      return {
        configured:
          true,
        authenticated:
          false,
        available:
          false,
        loginRequired:
          true,
        loginUrl:
          this.loginUrl()
      };
    }

    if (!me.ok) {
      return {
        configured:
          true,
        authenticated:
          false,
        available:
          false,
        error:
          "NARA_CLOUD_STATUS_FAILED"
      };
    }

    let identity;

    try {
      identity =
        await me.json();
    } catch {
      return {
        configured:
          true,
        authenticated:
          false,
        available:
          false,
        error:
          "NARA_CLOUD_STATUS_FAILED"
      };
    }

    if (
      identity
        ?.authenticated !==
          true ||
      typeof identity
        ?.csrfToken !==
          "string" ||
      identity.csrfToken
        .length < 16
    ) {
      return {
        configured:
          true,
        authenticated:
          false,
        available:
          false,
        error:
          "NARA_CLOUD_STATUS_FAILED"
      };
    }

    this.csrfToken =
      identity.csrfToken;

    let bridge;

    try {
      bridge =
        await this.request(
          "/api/humanale/status",
          {
            method:
              "GET",
            headers: {
              Accept:
                "application/json"
            }
          }
        );
    } catch {
      return {
        configured:
          true,
        authenticated:
          true,
        available:
          false,
        displayName:
          String(
            identity.displayName ??
            ""
          ),
        error:
          "HUMANALE_CLOUD_BRIDGE_UNREACHABLE"
      };
    }

    if (!bridge.ok) {
      return {
        configured:
          true,
        authenticated:
          true,
        available:
          false,
        displayName:
          String(
            identity.displayName ??
            ""
          ),
        error:
          "HUMANALE_CLOUD_BRIDGE_UNAVAILABLE"
      };
    }

    return {
      configured:
        true,
      authenticated:
        true,
      available:
        true,
      displayName:
        String(
          identity.displayName ??
          ""
        )
    };
  }

  async context(
    {
      target,
      mode,
      approved = false,
      entryIds
    } = {}
  ) {
    if (
      !TARGETS.has(
        target
      ) ||
      !MODES.has(
        mode
      )
    ) {
      return {
        error:
          "INVALID_CLOUD_CONTEXT_REQUEST"
      };
    }

    const status =
      await this.status();

    if (
      !status
        .authenticated ||
      !status.available
    ) {
      return status;
    }

    const body = {
      target,
      mode,
      approved:
        Boolean(
          approved
        )
    };

    if (
      Array.isArray(
        entryIds
      )
    ) {
      body.entryIds =
        entryIds;
    }

    let response;

    try {
      response =
        await this.request(
          "/api/humanale/context",
          {
            method:
              "POST",
            headers: {
              Accept:
                "application/json",
              "Content-Type":
                "application/json",
              "X-CSRF-Token":
                this.csrfToken,
              Origin:
                this.origin,
              Referer:
                this.origin +
                "/"
            },
            body:
              JSON.stringify(
                body
              )
          }
        );
    } catch {
      return {
        error:
          "HUMANALE_CLOUD_BRIDGE_UNREACHABLE"
      };
    }

    let payload = {};

    try {
      payload =
        await response.json();
    } catch {}

    if (!response.ok) {
      return {
        error:
          typeof payload
            ?.error ===
              "string"
            ? payload.error
            : "HUMANALE_CLOUD_BRIDGE_FAILED"
      };
    }

    if (
      payload.preview
    ) {
      return {
        preview:
          safePreview(
            payload.preview,
            target,
            mode
          )
      };
    }

    if (
      payload.context
    ) {
      return {
        context:
          this.validate(
            payload.context,
            {
              allowedTargets:
                [target]
            }
          )
      };
    }

    return {
      context:
        null
    };
  }
}

export const AleCoreCloudContextClient = NaraCloudContextClient;

export {
  normalizeOrigin
};
