
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { Prisma } from "../generated/prisma/client";

const router = Router();

const createRoomSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
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

    const room = await prisma.room.create({
      data: {
        name: result.data.name ?? "Untitled Board",
      },
    });

    return res.status(201).json({
      success: true,
      message: "Room created successfully",
      data: room,
    });
  } catch (error) {
    console.error("Create room error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create room",
    });
  }
});

// Get a room by ID
router.get("/:roomId", async (req, res) => {
  try {
    const room = await prisma.room.findUnique({
      where: {
        id: req.params.roomId,
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

const updateRoomSchema = z.object({
  boardData: z.record(z.string(), z.unknown()),
  expectedRevision: z.number().int().nonnegative(),
});

// Update room board data with optimistic concurrency control
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
      // Update only if the client's revision matches the database.
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
