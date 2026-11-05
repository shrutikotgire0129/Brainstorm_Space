import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import roomRoutes from "./routes/room.routes";

dotenv.config();

const app = express();

const PORT = Number(process.env.PORT) || 5000;

const FRONTEND_URL =
  process.env.FRONTEND_URL || "http://localhost:3000";

// Middleware
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

// Start server
app.listen(PORT, () => {
  console.log(`Brainstorm Space API running on http://localhost:${PORT}`);
});