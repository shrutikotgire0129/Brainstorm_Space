import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma";

export type OwnerAuthorizationResult =
  | {
      authorized: true;
    }
  | {
      authorized: false;
      status: 401 | 403 | 404;
      message: string;
    };

// Generate a cryptographically secure token.
export function generateSecureToken(): string {
  return randomBytes(32).toString("base64url");
}

// Store and compare only SHA-256 token hashes.
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Verify that the supplied Bearer token belongs to the room creator.
export async function verifyRoomOwner(
  roomId: string,
  authorization: string | undefined,
): Promise<OwnerAuthorizationResult> {
  const tokenMatch = authorization?.match(/^Bearer\s+([A-Za-z0-9_-]{40,128})$/);

  if (!tokenMatch) {
    return {
      authorized: false,
      status: 401,
      message: "Creator authorization token is required",
    };
  }

  const room = await prisma.room.findUnique({
    where: {
      id: roomId,
    },
    select: {
      id: true,
      ownerTokenHash: true,
    },
  });

  if (!room) {
    return {
      authorized: false,
      status: 404,
      message: "Room not found",
    };
  }

  if (!room.ownerTokenHash) {
    return {
      authorized: false,
      status: 403,
      message: "You are not authorized to manage this board",
    };
  }

  const suppliedHash = Buffer.from(hashToken(tokenMatch[1]), "hex");
  const storedHash = Buffer.from(room.ownerTokenHash, "hex");

  if (
    suppliedHash.length !== storedHash.length ||
    !timingSafeEqual(suppliedHash, storedHash)
  ) {
    return {
      authorized: false,
      status: 403,
      message: "You are not authorized to manage this board",
    };
  }

  return {
    authorized: true,
  };
}
