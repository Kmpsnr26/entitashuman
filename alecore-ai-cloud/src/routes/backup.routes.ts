import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import {
  BackupExportError,
  createMemoryBackupSnapshot
} from "../services/backup-export.service.js";

import {
  googleDriveBackupStatus,
  GoogleDriveBackupError,
  uploadMemoryBackupToGoogleDrive
} from "../services/google-drive-backup.service.js";

import {
  encryptMemoryBackup,
  EncryptedBackupError
} from "../services/encrypted-backup.service.js";

import {
  audit
} from "../services/audit.service.js";

import {
  requireApiAuth
} from "../middleware/requireAuth.js";

import {
  requireCsrf
} from "../middleware/requireCsrf.js";

import {
  requireTrustedOrigin
} from "../middleware/requireTrustedOrigin.js";

import {
  requireJsonContentType
} from "../middleware/requireJsonContentType.js";

const router =
  express.Router();

const UsbBackupRequestSchema =
  z.object({
    passphrase:
      z.string()
        .min(16)
        .max(256)
        .refine(
          value =>
            value.trim()
              .length >= 16,
          {
            message:
              "passphrase is too weak"
          }
        )
  });

const backupLimiter =
  rateLimit({
    windowMs:
      60 * 60 * 1000,

    limit:
      5,

    standardHeaders:
      true,

    legacyHeaders:
      false,

    message: {
      error:
        "BACKUP_RATE_LIMITED"
    }
  });

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

function usbBackupName(
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
    "alecore-ai-memory-backup-" +
    safeTimestamp +
    ".nara"
  );
}

function publicUsbError(
  error: unknown
): {
  code: string;
  status: number;
} | null {
  if (
    error instanceof
      BackupExportError
  ) {
    return {
      code:
        error.code,
      status:
        413
    };
  }

  if (
    !(error instanceof
      EncryptedBackupError)
  ) {
    return null;
  }

  switch (error.code) {
    case
      "USB_BACKUP_TOO_LARGE":
      return {
        code:
          error.code,
        status:
          413
      };

    case
      "USB_BACKUP_INVALID_ENVELOPE":
    case
      "USB_BACKUP_DECRYPT_FAILED":
      return {
        code:
          "USB_BACKUP_FAILED",
        status:
          500
      };
  }
}

function publicDriveError(
  error: unknown
): {
  code: string;
  status: number;
} | null {
  if (
    error instanceof
      BackupExportError
  ) {
    return {
      code:
        error.code,
      status:
        413
    };
  }

  if (
    !(error instanceof
      GoogleDriveBackupError)
  ) {
    return null;
  }

  switch (error.code) {
    case
      "GOOGLE_DRIVE_NOT_CONFIGURED":
      return {
        code:
          error.code,
        status:
          503
      };

    case
      "GOOGLE_DRIVE_BACKUP_TOO_LARGE":
      return {
        code:
          error.code,
        status:
          413
      };

    case
      "GOOGLE_DRIVE_RATE_LIMITED":
      return {
        code:
          error.code,
        status:
          503
      };

    case
      "GOOGLE_DRIVE_UNAVAILABLE":
      return {
        code:
          error.code,
        status:
          503
      };

    case
      "GOOGLE_DRIVE_AUTH_FAILED":
      return {
        code:
          error.code,
        status:
          502
      };

    case
      "GOOGLE_DRIVE_REQUEST_FAILED":
      return {
        code:
          error.code,
        status:
          502
      };
  }
}

router.use(
  requireApiAuth
);

router.get(
  "/google-drive",
  (
    _req,
    res
  ) => {
    noStore(res);

    return res.json(
      googleDriveBackupStatus()
    );
  }
);

router.post(
  "/google-drive",
  backupLimiter,
  requireTrustedOrigin,
  requireCsrf,
  async (
    req,
    res,
    next
  ) => {
    try {
      noStore(res);

      const snapshot =
        await createMemoryBackupSnapshot(
          req.session.userId!
        );

      const uploaded =
        await uploadMemoryBackupToGoogleDrive(
          snapshot
        );

      await audit({
        userId:
          req.session.userId!,
        eventType:
          "ALECORE_AI_GOOGLE_DRIVE_BACKUP_CREATED",
        request:
          req,
        metadata: {
          recordCount:
            snapshot.memories.length,
          size:
            uploaded.size
        }
      });

      return res
        .status(201)
        .json({
          backup: {
            id:
              uploaded.id,
            name:
              uploaded.name,
            createdTime:
              uploaded.createdTime,
            size:
              uploaded.size,
            recordCount:
              snapshot.memories
                .length
          }
        });
    } catch (error) {
      const publicFailure =
        publicDriveError(
          error
        );

      if (publicFailure) {
        return res
          .status(
            publicFailure.status
          )
          .json({
            error:
              publicFailure.code
          });
      }

      next(error);
    }
  }
);

router.post(
  "/usb",
  backupLimiter,
  requireTrustedOrigin,
  requireJsonContentType,
  requireCsrf,
  async (
    req,
    res,
    next
  ) => {
    try {
      noStore(res);

      const parsed =
        UsbBackupRequestSchema
          .safeParse(
            req.body
          );

      if (!parsed.success) {
        return res
          .status(400)
          .json({
            error:
              "INVALID_USB_BACKUP_REQUEST"
          });
      }

      const snapshot =
        await createMemoryBackupSnapshot(
          req.session.userId!
        );

      const encrypted =
        await encryptMemoryBackup(
          snapshot,
          parsed.data.passphrase
        );

      const body =
        JSON.stringify(
          encrypted
        );

      await audit({
        userId:
          req.session.userId!,
        eventType:
          "ALECORE_AI_USB_BACKUP_CREATED",
        request:
          req,
        metadata: {
          recordCount:
            snapshot.memories.length,
          encryptedBytes:
            Buffer.byteLength(
              body,
              "utf8"
            ),
          algorithm:
            encrypted.algorithm,
          kdf:
            encrypted.kdf
        }
      });

      res.setHeader(
        "Content-Type",
        "application/vnd.ale.backup+json; charset=utf-8"
      );

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${usbBackupName(snapshot.exportedAt)}"`
      );

      res.setHeader(
        "X-Content-Type-Options",
        "nosniff"
      );

      return res
        .status(201)
        .send(body);
    } catch (error) {
      const publicFailure =
        publicUsbError(
          error
        );

      if (publicFailure) {
        return res
          .status(
            publicFailure.status
          )
          .json({
            error:
              publicFailure.code
          });
      }

      next(error);
    }
  }
);

export {
  router as backupRouter
};
