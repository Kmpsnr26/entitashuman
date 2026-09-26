import {
  randomBytes
} from "node:crypto";

import {
  env
} from "../config/env.js";

import type {
  MemoryBackupSnapshot
} from "./backup-export.service.js";

const GOOGLE_TOKEN_URL =
  "https://oauth2.googleapis.com/token";

const GOOGLE_DRIVE_UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id%2Cname%2CcreatedTime%2Csize";

const GOOGLE_DRIVE_MAX_MULTIPART_BYTES =
  4_500_000;

type FetchLike =
  typeof fetch;

interface DriveConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  folderId: string;
}

export interface GoogleDriveBackupResult {
  id: string;
  name: string;
  createdTime: string | null;
  size: string | null;
}

export class GoogleDriveBackupError
  extends Error {
  readonly code:
    | "GOOGLE_DRIVE_NOT_CONFIGURED"
    | "GOOGLE_DRIVE_BACKUP_TOO_LARGE"
    | "GOOGLE_DRIVE_AUTH_FAILED"
    | "GOOGLE_DRIVE_RATE_LIMITED"
    | "GOOGLE_DRIVE_UNAVAILABLE"
    | "GOOGLE_DRIVE_REQUEST_FAILED";

  constructor(
    code:
      GoogleDriveBackupError["code"]
  ) {
    super(code);
    this.name =
      "GoogleDriveBackupError";
    this.code = code;
  }
}

function driveConfig():
  DriveConfig | null {
  const {
    GOOGLE_DRIVE_CLIENT_ID:
      clientId,
    GOOGLE_DRIVE_CLIENT_SECRET:
      clientSecret,
    GOOGLE_DRIVE_REFRESH_TOKEN:
      refreshToken,
    GOOGLE_DRIVE_BACKUP_FOLDER_ID:
      folderId
  } = env;

  if (
    !clientId ||
    !clientSecret ||
    !refreshToken ||
    !folderId
  ) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    refreshToken,
    folderId
  };
}

function safeDriveError(
  status: number
): GoogleDriveBackupError {
  if (
    status === 401 ||
    status === 403
  ) {
    return new GoogleDriveBackupError(
      "GOOGLE_DRIVE_AUTH_FAILED"
    );
  }

  if (status === 429) {
    return new GoogleDriveBackupError(
      "GOOGLE_DRIVE_RATE_LIMITED"
    );
  }

  if (status >= 500) {
    return new GoogleDriveBackupError(
      "GOOGLE_DRIVE_UNAVAILABLE"
    );
  }

  return new GoogleDriveBackupError(
    "GOOGLE_DRIVE_REQUEST_FAILED"
  );
}

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null
  );
}

async function accessToken(
  config: DriveConfig,
  fetchImpl: FetchLike
): Promise<string> {
  let response: Response;

  try {
    response =
      await fetchImpl(
        GOOGLE_TOKEN_URL,
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded"
          },

          body:
            new URLSearchParams({
              client_id:
                config.clientId,
              client_secret:
                config.clientSecret,
              refresh_token:
                config.refreshToken,
              grant_type:
                "refresh_token"
            }),

          signal:
            AbortSignal.timeout(
              10_000
            )
        }
      );
  } catch {
    throw new GoogleDriveBackupError(
      "GOOGLE_DRIVE_UNAVAILABLE"
    );
  }

  if (!response.ok) {
    throw safeDriveError(
      response.status
    );
  }

  let payload: unknown;

  try {
    payload =
      await response.json();
  } catch {
    throw new GoogleDriveBackupError(
      "GOOGLE_DRIVE_AUTH_FAILED"
    );
  }

  if (
    !isRecord(payload) ||
    typeof payload.access_token !==
      "string" ||
    payload.access_token.length <
      10
  ) {
    throw new GoogleDriveBackupError(
      "GOOGLE_DRIVE_AUTH_FAILED"
    );
  }

  return payload.access_token;
}

function backupName(
  exportedAt: string
): string {
  const safeTimestamp =
    exportedAt
      .replaceAll(
        ":",
        "-"
      )
      .replaceAll(
        ".",
        "-"
      );

  return (
    "nara-memory-backup-" +
    safeTimestamp +
    ".json"
  );
}

function multipartBody(
  snapshotJson: string,
  name: string,
  folderId: string
): {
  boundary: string;
  body: string;
} {
  const boundary =
    "nara_" +
    randomBytes(16)
      .toString("hex");

  const metadata =
    JSON.stringify({
      name,
      parents:
        [folderId],
      mimeType:
        "application/json"
    });

  const body = [
    `--${boundary}\r\n`,
    "Content-Type: application/json; charset=UTF-8\r\n\r\n",
    metadata,
    "\r\n",
    `--${boundary}\r\n`,
    "Content-Type: application/json; charset=UTF-8\r\n\r\n",
    snapshotJson,
    "\r\n",
    `--${boundary}--\r\n`
  ].join("");

  return {
    boundary,
    body
  };
}

export function googleDriveBackupStatus(): {
  configured: boolean;
  maxUploadBytes: number;
} {
  return {
    configured:
      driveConfig() !== null,

    maxUploadBytes:
      GOOGLE_DRIVE_MAX_MULTIPART_BYTES
  };
}

export async function uploadMemoryBackupToGoogleDrive(
  snapshot: MemoryBackupSnapshot,
  fetchImpl: FetchLike = fetch
): Promise<GoogleDriveBackupResult> {
  const config =
    driveConfig();

  if (!config) {
    throw new GoogleDriveBackupError(
      "GOOGLE_DRIVE_NOT_CONFIGURED"
    );
  }

  const snapshotJson =
    JSON.stringify(
      snapshot
    );

  if (
    Buffer.byteLength(
      snapshotJson,
      "utf8"
    ) >
    GOOGLE_DRIVE_MAX_MULTIPART_BYTES
  ) {
    throw new GoogleDriveBackupError(
      "GOOGLE_DRIVE_BACKUP_TOO_LARGE"
    );
  }

  const token =
    await accessToken(
      config,
      fetchImpl
    );

  const name =
    backupName(
      snapshot.exportedAt
    );

  const multipart =
    multipartBody(
      snapshotJson,
      name,
      config.folderId
    );

  let response: Response;

  try {
    response =
      await fetchImpl(
        GOOGLE_DRIVE_UPLOAD_URL,
        {
          method:
            "POST",

          headers: {
            Authorization:
              `Bearer ${token}`,

            "Content-Type":
              `multipart/related; boundary=${multipart.boundary}`
          },

          body:
            multipart.body,

          signal:
            AbortSignal.timeout(
              30_000
            )
        }
      );
  } catch {
    throw new GoogleDriveBackupError(
      "GOOGLE_DRIVE_UNAVAILABLE"
    );
  }

  if (!response.ok) {
    throw safeDriveError(
      response.status
    );
  }

  let payload: unknown;

  try {
    payload =
      await response.json();
  } catch {
    throw new GoogleDriveBackupError(
      "GOOGLE_DRIVE_REQUEST_FAILED"
    );
  }

  if (
    !isRecord(payload) ||
    typeof payload.id !==
      "string" ||
    typeof payload.name !==
      "string"
  ) {
    throw new GoogleDriveBackupError(
      "GOOGLE_DRIVE_REQUEST_FAILED"
    );
  }

  return {
    id:
      payload.id,

    name:
      payload.name,

    createdTime:
      typeof payload.createdTime ===
        "string"
        ? payload.createdTime
        : null,

    size:
      typeof payload.size ===
        "string"
        ? payload.size
        : null
  };
}

export {
  GOOGLE_DRIVE_MAX_MULTIPART_BYTES
};
