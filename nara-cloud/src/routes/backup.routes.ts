import express from "express";
import rateLimit from "express-rate-limit";

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
  audit
} from "../services/audit.service.js";

import {
  requireApiAuth
} from "../middleware/requireAuth.js";

import {
  requireCsrf
} from "../middleware/requireCsrf.js";

const router =
  express.Router();

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
          "NARA_GOOGLE_DRIVE_BACKUP_CREATED",
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

export {
  router as backupRouter
};
