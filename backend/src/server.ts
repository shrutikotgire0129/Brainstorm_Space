
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

const FRONTEND_URL =
  process.env.FRONTEND_URL || "http://localhost:3000";

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
  })
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

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Join an existing whiteboard room.
  socket.on("join-room", async (roomId: unknown) => {
    try {
      if (
        typeof roomId !== "string" ||
        !roomId.trim() ||
        roomId.length > 64
      ) {
        return;
      }

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

      socket.join(roomId);
      console.log(`Socket ${socket.id} joined room ${roomId}`);
    } catch (error) {
      console.error("Failed to join room:", error);
    }
  });

  // Leave a whiteboard room.
  socket.on("leave-room", (roomId: unknown) => {
    if (typeof roomId !== "string" || !roomId.trim()) {
      return;
    }

    socket.leave(roomId);
    console.log(`Socket ${socket.id} left room ${roomId}`);
  });

  // Broadcast board changes to other participants.
  socket.on(
    "board-update",
    (payload: { roomId?: unknown; boardState?: unknown }) => {
      try {
        const { roomId, boardState } = payload ?? {};

        if (
          typeof roomId !== "string" ||
          !roomId.trim() ||
          roomId.length > 64 ||
          !socket.rooms.has(roomId) ||
          !boardState ||
          typeof boardState !== "object" ||
          Array.isArray(boardState)
        ) {
          return;
        }

        const serializedState = JSON.stringify(boardState);

        if (serializedState.length > 900_000) {
          return;
        }

        socket.to(roomId).emit("board-update", {
          boardState,
        });
      } catch (error) {
        console.error("Failed to broadcast board update:", error);
      }
    },
  );

  socket.on("disconnect", (reason) => {
    console.log(`Socket disconnected: ${socket.id} (${reason})`);
  });
});

// Start HTTP and Socket.IO server
httpServer.listen(PORT, () => {
  console.log(
    `Brainstorm Space API running on http://localhost:${PORT}`
  );
  console.log("Socket.IO server is ready.");
});
