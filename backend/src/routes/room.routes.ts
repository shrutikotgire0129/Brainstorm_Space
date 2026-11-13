
import { Router } from "express";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { Prisma } from "../generated/prisma/client";

const router = Router();

const createRoomSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
});

const renameRoomSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

// Generate a cryptographically secure creator token.
function generateOwnerToken(): string {
  return randomBytes(32).toString("base64url");
}

// Store only the SHA-256 hash of the creator token.
function hashOwnerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

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

    const ownerToken = generateOwnerToken();

    const room = await prisma.room.create({
      data: {
        name: result.data.name ?? "Untitled Board",
        ownerTokenHash: hashOwnerToken(ownerToken),
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

    const authorization = req.get("authorization");
    const tokenMatch = authorization?.match(
      /^Bearer\s+([A-Za-z0-9_-]{40,128})$/,
    );

    if (!tokenMatch) {
      return res.status(401).json({
        success: false,
        message: "Creator authorization token is required",
      });
    }

    const ownerTokenHash = hashOwnerToken(tokenMatch[1]);

    const updateResult = await prisma.room.updateMany({
      where: {
        id: req.params.roomId,
        ownerTokenHash,
      },
      data: {
        name: result.data.name,
      },
    });

    if (updateResult.count === 0) {
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

      return res.status(403).json({
        success: false,
        message: "You are not authorized to rename this board",
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

export default router;
