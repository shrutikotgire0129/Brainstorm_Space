import { SharePermission } from "../generated/prisma/enums";
import { validateGuestCredential } from "./guest-access";
import { verifyRoomOwner } from "./owner-auth";

export type RoomRole = "OWNER" | "EDITOR" | "VIEWER";

export type RoomAuthorizationResult =
  | {
      authorized: true;
      role: RoomRole;
      participant?: {
        id: string;
        name: string;
      };
    }
  | {
      authorized: false;
      status: 401 | 404;
      message: string;
    };

/**
 * Authorizes a room using its owner token or persistent guest credential.
 */
export async function authorizeRoomCredential(
  roomId: string,
  credential: string | undefined,
): Promise<RoomAuthorizationResult> {
  if (!credential || !/^[A-Za-z0-9_-]{40,128}$/.test(credential)) {
    return {
      authorized: false,
      status: 401,
      message: "Valid room access credentials are required.",
    };
  }

  const ownerResult = await verifyRoomOwner(roomId, `Bearer ${credential}`);

  if (ownerResult.authorized) {
    return {
      authorized: true,
      role: "OWNER",
    };
  }

  if (ownerResult.status === 404) {
    return {
      authorized: false,
      status: 404,
      message: ownerResult.message,
    };
  }

  const guest = await validateGuestCredential(roomId, credential);

  if (!guest) {
    return {
      authorized: false,
      status: 401,
      message: "Invalid or expired room access credentials.",
    };
  }

  return {
    authorized: true,
    role: guest.permission === SharePermission.EDITOR ? "EDITOR" : "VIEWER",
    participant: {
      id: guest.participantId,
      name: guest.participantName,
    },
  };
}

/**
 * Authorizes a REST request using its Authorization header.
 */
export async function authorizeRoomRequest(
  roomId: string,
  authorization: string | undefined,
): Promise<RoomAuthorizationResult> {
  const tokenMatch = authorization
    ?.trim()
    .match(/^Bearer\s+([A-Za-z0-9_-]{40,128})$/i);

  return authorizeRoomCredential(roomId, tokenMatch?.[1]);
}
