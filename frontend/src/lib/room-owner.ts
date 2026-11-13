
const OWNER_TOKEN_PREFIX = "brainstorm-space-owner:";

export function saveRoomOwnerToken(
  roomId: string,
  token: string,
): void {
  if (!roomId || !/^[A-Za-z0-9_-]{40,128}$/.test(token)) {
    throw new Error("Invalid board ownership credentials.");
  }

  sessionStorage.setItem(
    `${OWNER_TOKEN_PREFIX}${roomId}`,
    token,
  );
}

export function getRoomOwnerToken(
  roomId: string,
): string | null {
  if (typeof window === "undefined" || !roomId) {
    return null;
  }

  try {
    const token = sessionStorage.getItem(
      `${OWNER_TOKEN_PREFIX}${roomId}`,
    );

    if (!token || !/^[A-Za-z0-9_-]{40,128}$/.test(token)) {
      return null;
    }

    return token;
  } catch {
    return null;
  }
}
