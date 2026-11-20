import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";
import roomRoutes from "./routes/room.routes";
import { prisma } from "./lib/prisma";
import { randomUUID } from "crypto";
import { authorizeRoomCredential } from "./lib/room-auth";

dotenv.config();

const app = express();

app.set("trust proxy", 1);

const httpServer = createServer(app);

const PORT = Number(process.env.PORT) || 5000;

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

// Socket.IO configuration
const io = new Server(httpServer, {
  maxHttpBufferSize: 1_000_000,
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
  let roomOperationId = 0;
  let pendingRoomId: string | null = null;

  socket.on("join-room", async (payload: unknown) => {
    let operationId: number | null = null;

    try {
      if (!payload || typeof payload !== "object") return;

      const { roomId } = payload as {
        roomId?: unknown;
      };

      if (typeof roomId !== "string" || !roomId.trim() || roomId.length > 64) {
        return;
      }
      operationId = ++roomOperationId;
      pendingRoomId = roomId;
      const credential = socket.handshake.auth?.credential;

      const authorization = await authorizeRoomCredential(
        roomId,
        typeof credential === "string" ? credential : undefined,
      );

      if (!socket.connected || operationId !== roomOperationId) {
        if (operationId === roomOperationId) {
          pendingRoomId = null;
        }
        return;
      }

      if (!authorization.authorized) {
        pendingRoomId = null;
        if (currentRoomId) {
          socket.leave(currentRoomId);
          removeParticipant(socket.id, currentRoomId);
          currentRoomId = null;
        }

        socket.emit("room-error", {
          message: "You do not have valid access to this room.",
        });
        return;
      }

      const participant = {
        socketId: socket.id,
        id: authorization.participant?.id ?? randomUUID(),
        name: authorization.participant?.name ?? "Owner",
        color: "#8B5CF6",
      };

      // Remove the participant from their previous room, if necessary.
      if (currentRoomId && currentRoomId !== roomId) {
        socket.leave(currentRoomId);
        removeParticipant(socket.id, currentRoomId);
      }

      await socket.join(roomId);

      if (!socket.connected || operationId !== roomOperationId) {
        if (operationId === roomOperationId) {
          pendingRoomId = null;
        }

        if (currentRoomId !== roomId) {
          socket.leave(roomId);
        }
        return;
      }
      pendingRoomId = null;

      currentRoomId = roomId;

      const roomParticipants = participantsByRoom.get(roomId) ?? new Map();

      roomParticipants.set(socket.id, participant);
      participantsByRoom.set(roomId, roomParticipants);

      broadcastPresence(roomId);
    } catch (error) {
      if (operationId === roomOperationId) {
        pendingRoomId = null;
      }

      console.error("Failed to join room:", error);
    }
  });

  socket.on("leave-room", (roomId: unknown) => {
    if (typeof roomId !== "string" || !roomId.trim() || roomId.length > 64) {
      return;
    }

    const isPendingRoom = pendingRoomId === roomId;

    if (isPendingRoom) {
      roomOperationId++;
      pendingRoomId = null;
    }

    if (!socket.rooms.has(roomId)) {
      return;
    }

    if (!isPendingRoom && pendingRoomId === null && currentRoomId === roomId) {
      roomOperationId++;
    }

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

      const operationId = roomOperationId;
      const credential = socket.handshake.auth?.credential;

      const authorization = await authorizeRoomCredential(
        roomId,
        typeof credential === "string" ? credential : undefined,
      );

      if (
        !socket.connected ||
        operationId !== roomOperationId ||
        currentRoomId !== roomId ||
        !socket.rooms.has(roomId)
      ) {
        return;
      }

      if (!authorization.authorized) {
        socket.emit("room-error", {
          message: "Your room access has expired or been revoked.",
        });

        socket.leave(roomId);
        removeParticipant(socket.id, roomId);
        currentRoomId = null;
        socket.disconnect(true);
        return;
      }

      if (authorization.role === "VIEWER") {
        socket.emit("room-error", {
          message: "Editor permission is required to modify the board.",
        });
        return;
      }

      const serializedState = JSON.stringify(boardState);

      if (serializedState.length > 900_000) return;

      const room = await prisma.room.findUnique({
        where: { id: roomId },
        select: { revision: true },
      });

      if (
        !socket.connected ||
        operationId !== roomOperationId ||
        currentRoomId !== roomId ||
        !socket.rooms.has(roomId)
      ) {
        return;
      }

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
  socket.on("cursor-move", async (payload: unknown) => {
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

      const operationId = roomOperationId;
      const credential = socket.handshake.auth?.credential;

      const authorization = await authorizeRoomCredential(
        roomId,
        typeof credential === "string" ? credential : undefined,
      );

      if (
        !socket.connected ||
        operationId !== roomOperationId ||
        currentRoomId !== roomId ||
        !socket.rooms.has(roomId)
      ) {
        return;
      }

      if (!authorization.authorized) {
        socket.emit("room-error", {
          message: "Your room access has expired or been revoked.",
        });

        socket.leave(roomId);
        removeParticipant(socket.id, roomId);
        currentRoomId = null;
        socket.disconnect(true);
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
    roomOperationId++;
    pendingRoomId = null;
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
