
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";
import roomRoutes from "./routes/room.routes";
import { prisma } from "./lib/prisma";

dotenv.config();

const app = express();
const httpServer = createServer(app);

const PORT = Number(process.env.PORT) || 5000;

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

// Socket.IO configuration
const io = new Server(httpServer, {
  cors: {
    origin: FRONTEND_URL,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Express middleware
app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  }),
);

app.use(express.json({ limit: "1mb" }));

// Health check
app.get("/api/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Brainstorm Space API is running",
    timestamp: new Date().toISOString(),
  });
});

// Room routes
app.use("/api/rooms", roomRoutes);

type Participant = {
  id: string;
  name: string;
  color: string;
};

type RoomParticipant = Participant & {
  socketId: string;
};

const participantsByRoom = new Map<string, Map<string, RoomParticipant>>();

const broadcastPresence = (roomId: string) => {
  const participants = Array.from(
    participantsByRoom.get(roomId)?.values() ?? [],
  );

  io.to(roomId).emit("presence-update", participants);
};

const removeParticipant = (socketId: string, roomId: string) => {
  const roomParticipants = participantsByRoom.get(roomId);

  if (!roomParticipants) return;

  roomParticipants.delete(socketId);

  if (roomParticipants.size === 0) {
    participantsByRoom.delete(roomId);
  }

  broadcastPresence(roomId);
};

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  let currentRoomId: string | null = null;

  socket.on("join-room", async (payload: unknown) => {
    try {
      if (!payload || typeof payload !== "object") return;

      const { roomId, participant } = payload as {
        roomId?: unknown;
        participant?: unknown;
      };

      if (
        typeof roomId !== "string" ||
        !roomId.trim() ||
        roomId.length > 64 ||
        !participant ||
        typeof participant !== "object"
      )
        return;

      const candidate = participant as Record<string, unknown>;

      if (
        typeof candidate.id !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(candidate.id) ||
        typeof candidate.name !== "string" ||
        !candidate.name.trim() ||
        candidate.name.length > 32 ||
        typeof candidate.color !== "string" ||
        !/^#[0-9a-f]{6}$/i.test(candidate.color)
      )
        return;

      const room = await prisma.room.findUnique({
        where: { id: roomId },
        select: { id: true },
      });

      if (!room) {
        socket.emit("room-error", {
          message: "Room does not exist.",
        });
        return;
      }

      // Remove the participant from their previous room, if necessary.
      if (currentRoomId && currentRoomId !== roomId) {
        socket.leave(currentRoomId);
        removeParticipant(socket.id, currentRoomId);
      }

      await socket.join(roomId);
      currentRoomId = roomId;

      const roomParticipants = participantsByRoom.get(roomId) ?? new Map();

      roomParticipants.set(socket.id, {
        socketId: socket.id,
        id: candidate.id,
        name: candidate.name.trim(),
        color: candidate.color,
      });

      participantsByRoom.set(roomId, roomParticipants);

      broadcastPresence(roomId);

      console.log(
        `Socket ${socket.id} joined room ${roomId} as ${candidate.name}`,
      );
    } catch (error) {
      console.error("Failed to join room:", error);
    }
  });

  socket.on("leave-room", (roomId: unknown) => {
    if (
      typeof roomId !== "string" ||
      !roomId.trim() ||
      roomId.length > 64 ||
      !socket.rooms.has(roomId)
    )
      return;

    socket.leave(roomId);
    removeParticipant(socket.id, roomId);

    if (currentRoomId === roomId) {
      currentRoomId = null;
    }

    console.log(`Socket ${socket.id} left room ${roomId}`);
  });

  // Broadcast only successfully persisted board revisions.
  socket.on("board-update", async (payload: unknown) => {
    try {
      if (!payload || typeof payload !== "object") return;

      const { roomId, boardState, revision } = payload as {
        roomId?: unknown;
        boardState?: unknown;
        revision?: unknown;
      };

      if (
        typeof roomId !== "string" ||
        !roomId.trim() ||
        roomId.length > 64 ||
        !socket.rooms.has(roomId) ||
        currentRoomId !== roomId ||
        !boardState ||
        typeof boardState !== "object" ||
        Array.isArray(boardState) ||
        typeof revision !== "number" ||
        !Number.isInteger(revision) ||
        revision < 1
      ) {
        return;
      }

      const serializedState = JSON.stringify(boardState);

      if (serializedState.length > 900_000) return;

      const room = await prisma.room.findUnique({
        where: { id: roomId },
        select: { revision: true },
      });

      if (!room || room.revision !== revision) {
        console.warn(
          `Rejected stale or uncommitted board broadcast for room ${roomId}.`,
        );
        return;
      }

      socket.to(roomId).emit("board-update", {
        boardState,
        revision,
      });
    } catch (error) {
      console.error("Failed to broadcast board update:", error);
    }
  });

  // Broadcast live cursor positions to other participants in the room.
  socket.on("cursor-move", (payload: unknown) => {
    try {
      if (!payload || typeof payload !== "object") return;

      const { roomId, x, y } = payload as {
        roomId?: unknown;
        x?: unknown;
        y?: unknown;
      };

      if (
        typeof roomId !== "string" ||
        !roomId.trim() ||
        roomId.length > 64 ||
        !socket.rooms.has(roomId) ||
        currentRoomId !== roomId ||
        typeof x !== "number" ||
        typeof y !== "number" ||
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        x > 1 ||
        y < 0 ||
        y > 1
      ) {
        return;
      }

      socket.to(roomId).emit("cursor-update", {
        socketId: socket.id,
        x,
        y,
      });
    } catch (error) {
      console.error("Failed to broadcast cursor position:", error);
    }
  });

  socket.on("disconnect", (reason) => {
    if (currentRoomId) {
      removeParticipant(socket.id, currentRoomId);
      currentRoomId = null;
    }

    console.log(`Socket disconnected: ${socket.id} (${reason})`);
  });
});

// Start HTTP and Socket.IO server
httpServer.listen(PORT, () => {
  console.log(`Brainstorm Space API running on http://localhost:${PORT}`);
  console.log("Socket.IO server is ready.");
});
