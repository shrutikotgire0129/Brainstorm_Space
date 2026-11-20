const GUEST_CREDENTIAL_PREFIX = "brainstorm-space-guest:";

export function getGuestCredential(roomId: string): string | null {
  if (typeof window === "undefined" || !roomId) {
    return null;
  }

  try {
    const credential = localStorage.getItem(
      `${GUEST_CREDENTIAL_PREFIX}${roomId}`,
    );

    if (!credential || !/^[A-Za-z0-9_-]{40,128}$/.test(credential)) {
      return null;
    }

    return credential;
  } catch {
    return null;
  }
}

export function saveGuestCredential(roomId: string, credential: string): void {
  if (!roomId || !/^[A-Za-z0-9_-]{40,128}$/.test(credential)) {
    throw new Error("Invalid guest access credential.");
  }

  localStorage.setItem(`${GUEST_CREDENTIAL_PREFIX}${roomId}`, credential);
}

export function removeGuestCredential(roomId: string): void {
  if (typeof window === "undefined" || !roomId) {
    return;
  }

  try {
    localStorage.removeItem(`${GUEST_CREDENTIAL_PREFIX}${roomId}`);
  } catch {
    // Ignore storage access failures.
  }
}
