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
});

// Update room board data
router.put("/:roomId", async (req, res) => {
  try {
    const result = updateRoomSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid board data",
        errors: result.error.flatten(),
      });
    }

    const existingRoom = await prisma.room.findUnique({
      where: {
        id: req.params.roomId,
      },
      select: {
        id: true,
      },
    });

    if (!existingRoom) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    const updatedRoom = await prisma.room.update({
      where: {
        id: req.params.roomId,
      },
      data: {
        boardData: result.data.boardData as Prisma.InputJsonValue,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Board saved successfully",
      data: updatedRoom,
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