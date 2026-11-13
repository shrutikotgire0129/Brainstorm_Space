import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { Prisma } from "../generated/prisma/client";
import {
  generateSecureToken,
  hashToken,
  verifyRoomOwner,
} from "../lib/owner-auth";

const router = Router();

const createRoomSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
});

const renameRoomSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

const shareLinkSchema = z.object({
  permission: z.enum(["VIEWER", "EDITOR"]).optional(),
  accessMode: z.enum(["INSTANT", "APPROVAL"]).optional(),
  expiresAt: z
    .string()
    .datetime()
    .refine(
      (value) => new Date(value).getTime() > Date.now(),
      "Expiration must be in the future",
    )
    .nullable()
    .optional(),
});

const createInvitationSchema = z.object({
  permission: z.enum(["VIEWER", "EDITOR"]).default("VIEWER"),
  expiresAt: z
    .string()
    .datetime()
    .refine(
      (value) => new Date(value).getTime() > Date.now(),
      "Expiration must be in the future",
    )
    .nullable()
    .optional(),
});

// Create a room
router.post("/", async (req, res) => {
  try {
    const result = createRoomSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid room data",
        errors: result.error.flatten(),
      });
    }

    const ownerToken = generateSecureToken();

    const room = await prisma.room.create({
      data: {
        name: result.data.name ?? "Untitled Board",
        ownerTokenHash: hashToken(ownerToken),
      },
      select: {
        id: true,
        name: true,
        boardData: true,
        revision: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Room created successfully",
      data: {
        ...room,
        ownerToken,
      },
    });
  } catch (error) {
    console.error("Create room error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create room",
    });
  }
});

// Get a room by ID.
// Never expose the creator token hash.
router.get("/:roomId", async (req, res) => {
  try {
    const room = await prisma.room.findUnique({
      where: {
        id: req.params.roomId,
      },
      select: {
        id: true,
        name: true,
        boardData: true,
        revision: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: room,
    });
  } catch (error) {
    console.error("Get room error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve room",
    });
  }
});

// Rename a room.
// Requires the creator token in the Authorization header.
router.patch("/:roomId/name", async (req, res) => {
  try {
    const result = renameRoomSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid board name",
        errors: result.error.flatten(),
      });
    }

    const authorization = await verifyRoomOwner(
      req.params.roomId,
      req.get("authorization"),
    );

    if (!authorization.authorized) {
      return res.status(authorization.status).json({
        success: false,
        message: authorization.message,
      });
    }

    const updateResult = await prisma.room.updateMany({
      where: {
        id: req.params.roomId,
      },
      data: {
        name: result.data.name,
      },
    });

    if (updateResult.count === 0) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    const updatedRoom = await prisma.room.findUnique({
      where: {
        id: req.params.roomId,
      },
      select: {
        id: true,
        name: true,
        boardData: true,
        revision: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!updatedRoom) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Board renamed successfully",
      data: updatedRoom,
    });
  } catch (error) {
    console.error("Rename room error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to rename board",
    });
  }
});

const updateRoomSchema = z.object({
  boardData: z.record(z.string(), z.unknown()),
  expectedRevision: z.number().int().nonnegative(),
});

// Update room board data with optimistic concurrency control.
router.put("/:roomId", async (req, res) => {
  try {
    const result = updateRoomSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid board data or expected revision",
        errors: result.error.flatten(),
      });
    }

    const { boardData, expectedRevision } = result.data;

    const saveResult = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.room.updateMany({
        where: {
          id: req.params.roomId,
          revision: expectedRevision,
        },
        data: {
          boardData: boardData as Prisma.InputJsonValue,
          revision: {
            increment: 1,
          },
        },
      });

      if (updateResult.count === 0) {
        const currentRoom = await tx.room.findUnique({
          where: {
            id: req.params.roomId,
          },
          select: {
            revision: true,
          },
        });

        if (!currentRoom) {
          return {
            status: "not_found" as const,
          };
        }

        return {
          status: "conflict" as const,
          currentRevision: currentRoom.revision,
        };
      }

      const updatedRoom = await tx.room.findUnique({
        where: {
          id: req.params.roomId,
        },
        select: {
          id: true,
          name: true,
          boardData: true,
          revision: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!updatedRoom) {
        return {
          status: "not_found" as const,
        };
      }

      return {
        status: "saved" as const,
        room: updatedRoom,
      };
    });

    if (saveResult.status === "not_found") {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    if (saveResult.status === "conflict") {
      return res.status(409).json({
        success: false,
        message: "Board was modified by another session",
        code: "REVISION_CONFLICT",
        expectedRevision,
        currentRevision: saveResult.currentRevision,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Board saved successfully",
      data: saveResult.room,
    });
  } catch (error) {
    console.error("Update room error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to save board",
    });
  }
});

// Get reusable board share-link settings.
// Requires creator authorization.
router.get("/:roomId/share-link", async (req, res) => {
  try {
    const authorization = await verifyRoomOwner(
      req.params.roomId,
      req.get("authorization"),
    );

    if (!authorization.authorized) {
      return res.status(authorization.status).json({
        success: false,
        message: authorization.message,
      });
    }

    const settings = await prisma.boardShareSettings.findUnique({
      where: {
        roomId: req.params.roomId,
      },
      select: {
        id: true,
        tokenHash: true,
        permission: true,
        accessMode: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const publicSettings = settings
      ? {
          id: settings.id,
          permission: settings.permission,
          accessMode: settings.accessMode,
          expiresAt: settings.expiresAt,
          revokedAt: settings.revokedAt,
          createdAt: settings.createdAt,
          updatedAt: settings.updatedAt,
        }
      : null;

    return res.status(200).json({
      success: true,
      data: {
        enabled: Boolean(
          settings &&
          settings.tokenHash &&
          !settings.revokedAt &&
          (!settings.expiresAt || settings.expiresAt > new Date()),
        ),
        settings: publicSettings,
      },
    });
  } catch (error) {
    console.error("Get board share-link error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve share-link settings",
    });
  }
});

// Create or rotate a reusable board share link.
// Requires creator authorization.
router.post("/:roomId/share-link", async (req, res) => {
  try {
    const authorization = await verifyRoomOwner(
      req.params.roomId,
      req.get("authorization"),
    );

    if (!authorization.authorized) {
      return res.status(authorization.status).json({
        success: false,
        message: authorization.message,
      });
    }

    const result = shareLinkSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid share-link settings",
        errors: result.error.flatten(),
      });
    }

    const token = generateSecureToken();
    const tokenHash = hashToken(token);

    const settings = await prisma.$transaction(async (tx) => {
      const existingSettings = await tx.boardShareSettings.findUnique({
        where: {
          roomId: req.params.roomId,
        },
        select: {
          id: true,
          permission: true,
          accessMode: true,
          expiresAt: true,
        },
      });

      if (existingSettings) {
        await tx.boardGuestAccess.updateMany({
          where: {
            sourceShareSettingsId: existingSettings.id,
            revokedAt: null,
          },
          data: {
            revokedAt: new Date(),
          },
        });
        await tx.boardAccessRequest.updateMany({
          where: {
            shareSettingsId: existingSettings.id,
            status: "PENDING",
          },
          data: {
            status: "REJECTED",
            reviewedAt: new Date(),
          },
        });
      }

      return tx.boardShareSettings.upsert({
        where: {
          roomId: req.params.roomId,
        },
        create: {
          roomId: req.params.roomId,
          tokenHash,
          permission: result.data.permission ?? "VIEWER",
          accessMode: result.data.accessMode ?? "INSTANT",
          expiresAt: result.data.expiresAt
            ? new Date(result.data.expiresAt)
            : null,
          revokedAt: null,
        },
        update: {
          tokenHash,
          permission:
            result.data.permission ?? existingSettings?.permission ?? "VIEWER",
          accessMode:
            result.data.accessMode ?? existingSettings?.accessMode ?? "INSTANT",
          expiresAt:
            result.data.expiresAt !== undefined
              ? result.data.expiresAt
                ? new Date(result.data.expiresAt)
                : null
              : (existingSettings?.expiresAt ?? null),
          revokedAt: null,
        },
        select: {
          id: true,
          permission: true,
          accessMode: true,
          expiresAt: true,
          revokedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    });

    return res.status(201).json({
      success: true,
      message: "Share link created successfully",
      data: {
        settings,
        token,
      },
    });
  } catch (error) {
    console.error("Create board share-link error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create share link",
    });
  }
});

// Update reusable board share-link settings.
// Requires creator authorization.
router.patch("/:roomId/share-link", async (req, res) => {
  try {
    const authorization = await verifyRoomOwner(
      req.params.roomId,
      req.get("authorization"),
    );

    if (!authorization.authorized) {
      return res.status(authorization.status).json({
        success: false,
        message: authorization.message,
      });
    }

    const result = shareLinkSchema.safeParse(req.body);

    if (!result.success || Object.keys(result.data ?? {}).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Provide at least one valid share-link setting",
        errors: result.success ? undefined : result.error.flatten(),
      });
    }

    const existingSettings = await prisma.boardShareSettings.findUnique({
      where: {
        roomId: req.params.roomId,
      },
      select: {
        id: true,
        tokenHash: true,
        revokedAt: true,
      },
    });

    if (
      !existingSettings ||
      !existingSettings.tokenHash ||
      existingSettings.revokedAt
    ) {
      return res.status(404).json({
        success: false,
        message: "An active share link was not found",
      });
    }

    const settings = await prisma.boardShareSettings.update({
      where: {
        roomId: req.params.roomId,
      },
      data: {
        ...(result.data.permission !== undefined && {
          permission: result.data.permission,
        }),
        ...(result.data.accessMode !== undefined && {
          accessMode: result.data.accessMode,
        }),
        ...(result.data.expiresAt !== undefined && {
          expiresAt: result.data.expiresAt
            ? new Date(result.data.expiresAt)
            : null,
        }),
      },
      select: {
        id: true,
        permission: true,
        accessMode: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Share-link settings updated successfully",
      data: settings,
    });
  } catch (error) {
    console.error("Update board share-link error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update share-link settings",
    });
  }
});

// Disable reusable board share link.
// Requires creator authorization.
router.delete("/:roomId/share-link", async (req, res) => {
  try {
    const authorization = await verifyRoomOwner(
      req.params.roomId,
      req.get("authorization"),
    );

    if (!authorization.authorized) {
      return res.status(authorization.status).json({
        success: false,
        message: authorization.message,
      });
    }

    const existingSettings = await prisma.boardShareSettings.findUnique({
      where: {
        roomId: req.params.roomId,
      },
      select: {
        id: true,
        tokenHash: true,
        revokedAt: true,
      },
    });

    if (
      !existingSettings ||
      !existingSettings.tokenHash ||
      existingSettings.revokedAt
    ) {
      return res.status(404).json({
        success: false,
        message: "An active share link was not found",
      });
    }

    await prisma.$transaction(async (tx) => {
      const revokedAt = new Date();

      await tx.boardShareSettings.update({
        where: {
          roomId: req.params.roomId,
        },
        data: {
          revokedAt,
        },
      });

      await tx.boardGuestAccess.updateMany({
        where: {
          sourceShareSettingsId: existingSettings.id,
          revokedAt: null,
        },
        data: {
          revokedAt,
        },
      });

      await tx.boardAccessRequest.updateMany({
        where: {
          shareSettingsId: existingSettings.id,
          status: "PENDING",
        },
        data: {
          status: "REJECTED",
          reviewedAt: revokedAt,
        },
      });
    });

    return res.status(200).json({
      success: true,
      message: "Share link revoked successfully",
    });
  } catch (error) {
    console.error("Revoke board share-link error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to revoke share link",
    });
  }
});

// Create an individual board invitation.
// Requires creator authorization.
router.post("/:roomId/invitations", async (req, res) => {
  try {
    const authorization = await verifyRoomOwner(
      req.params.roomId,
      req.get("authorization"),
    );

    if (!authorization.authorized) {
      return res.status(authorization.status).json({
        success: false,
        message: authorization.message,
      });
    }

    const result = createInvitationSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid invitation settings",
        errors: result.error.flatten(),
      });
    }

    const roomExists = await prisma.room.findUnique({
      where: {
        id: req.params.roomId,
      },
      select: {
        id: true,
      },
    });

    if (!roomExists) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    const token = generateSecureToken();

    const invitation = await prisma.boardInvite.create({
      data: {
        roomId: req.params.roomId,
        tokenHash: hashToken(token),
        permission: result.data.permission,
        expiresAt: result.data.expiresAt
          ? new Date(result.data.expiresAt)
          : null,
      },
      select: {
        id: true,
        roomId: true,
        permission: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Board invitation created successfully",
      data: {
        invitation,
        token,
      },
    });
  } catch (error) {
    console.error("Create board invitation error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create board invitation",
    });
  }
});

// List individual board invitations.
// Requires creator authorization.
router.get("/:roomId/invitations", async (req, res) => {
  try {
    const authorization = await verifyRoomOwner(
      req.params.roomId,
      req.get("authorization"),
    );

    if (!authorization.authorized) {
      return res.status(authorization.status).json({
        success: false,
        message: authorization.message,
      });
    }

    const invitations = await prisma.boardInvite.findMany({
      where: {
        roomId: req.params.roomId,
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        roomId: true,
        permission: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.status(200).json({
      success: true,
      data: invitations,
    });
  } catch (error) {
    console.error("List board invitations error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve board invitations",
    });
  }
});

// Revoke an individual board invitation.
// Also revokes guest access created through this invitation.
// Requires creator authorization.
router.delete("/:roomId/invitations/:inviteId", async (req, res) => {
  try {
    const authorization = await verifyRoomOwner(
      req.params.roomId,
      req.get("authorization"),
    );

    if (!authorization.authorized) {
      return res.status(authorization.status).json({
        success: false,
        message: authorization.message,
      });
    }

    const invitation = await prisma.boardInvite.findFirst({
      where: {
        id: req.params.inviteId,
        roomId: req.params.roomId,
      },
      select: {
        id: true,
        revokedAt: true,
      },
    });

    if (!invitation || invitation.revokedAt) {
      return res.status(404).json({
        success: false,
        message: "An active invitation was not found",
      });
    }

    await prisma.$transaction(async (tx) => {
      const revokedAt = new Date();

      await tx.boardInvite.update({
        where: {
          id: invitation.id,
        },
        data: {
          revokedAt,
        },
      });

      await tx.boardGuestAccess.updateMany({
        where: {
          sourceInviteId: invitation.id,
          revokedAt: null,
        },
        data: {
          revokedAt,
        },
      });
    });

    return res.status(200).json({
      success: true,
      message: "Board invitation revoked successfully",
    });
  } catch (error) {
    console.error("Revoke board invitation error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to revoke board invitation",
    });
  }
});

export default router;
