import {
  BoardAccessRequestStatus,
  ShareAccessMode,
  SharePermission,
} from "../generated/prisma/enums";
import { prisma } from "./prisma";
import { generateSecureToken, hashToken } from "./owner-auth";

export type GuestParticipant = {
  id: string;
  name: string;
};

export type GuestAccessResult =
  | {
      status: "GRANTED";
      roomId: string;
      credential: string;
      permission: SharePermission;
      expiresAt: Date | null;
      participant: GuestParticipant;
    }
  | {
      status: "PENDING";
      roomId: string;
      requestId: string;
      requestToken: string;
    };

export class GuestAccessError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409,
  ) {
    super(message);
    this.name = "GuestAccessError";
  }
}

function isExpired(expiresAt: Date | null): boolean {
  return expiresAt !== null && expiresAt.getTime() <= Date.now();
}

function isActive(revokedAt: Date | null, expiresAt: Date | null): boolean {
  return revokedAt === null && !isExpired(expiresAt);
}

/**
 * Redeems an individual invitation or reusable share link.
 *
 * Invitation links always grant access immediately.
 * Reusable links either grant access immediately or create an approval request.
 */
export async function redeemAccessToken(
  roomId: string,
  token: string,
  participant: GuestParticipant,
): Promise<GuestAccessResult> {
  if (!token || token.length < 40 || token.length > 128) {
    throw new GuestAccessError("Invalid access link", 404);
  }

  const tokenHash = hashToken(token);

  return prisma.$transaction(async (tx) => {
    // Check individual invitations first.
    const invitation = await tx.boardInvite.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        roomId: true,
        permission: true,
        expiresAt: true,
        revokedAt: true,
      },
    });

    if (invitation) {
      if (invitation.roomId !== roomId) {
        throw new GuestAccessError("Invalid access link for this board", 404);
      }

      if (!isActive(invitation.revokedAt, invitation.expiresAt)) {
        throw new GuestAccessError(
          "This invitation is expired or revoked",
          404,
        );
      }

      const credential = generateSecureToken();

      await tx.boardGuestAccess.create({
        data: {
          roomId: invitation.roomId,
          credentialHash: hashToken(credential),
          participantId: participant.id,
          participantName: participant.name,
          permission: invitation.permission,
          sourceInviteId: invitation.id,
          expiresAt: invitation.expiresAt,
        },
      });

      return {
        status: "GRANTED",
        roomId: roomId,
        credential,
        permission: invitation.permission,
        expiresAt: invitation.expiresAt,
        participant,
      };
    }

    // Otherwise, check the reusable share link.
    const settings = await tx.boardShareSettings.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        roomId: true,
        permission: true,
        accessMode: true,
        expiresAt: true,
        revokedAt: true,
      },
    });

    if (
      !settings ||
      settings.roomId !== roomId ||
      !isActive(settings.revokedAt, settings.expiresAt)
    ) {
      throw new GuestAccessError(
        "This share link is invalid, expired, or revoked",
        404,
      );
    }

    if (settings.accessMode === ShareAccessMode.INSTANT) {
      const credential = generateSecureToken();

      await tx.boardGuestAccess.create({
        data: {
          roomId: settings.roomId,
          credentialHash: hashToken(credential),
          participantId: participant.id,
          participantName: participant.name,
          permission: settings.permission,
          sourceShareSettingsId: settings.id,
          expiresAt: settings.expiresAt,
        },
      });

      return {
        status: "GRANTED",
        roomId: roomId,
        credential,
        permission: settings.permission,
        expiresAt: settings.expiresAt,
        participant,
      };
    }

    // Approval mode: the request token becomes the guest credential
    // only after the creator approves the request.
    const requestToken = generateSecureToken();

    const request = await tx.boardAccessRequest.create({
      data: {
        shareSettingsId: settings.id,
        participantId: participant.id,
        participantName: participant.name,
        requestTokenHash: hashToken(requestToken),
        status: BoardAccessRequestStatus.PENDING,
      },
      select: {
        id: true,
      },
    });

    return {
      status: "PENDING",
      roomId,
      requestId: request.id,
      requestToken,
    };
  });
}

/**
 * Retrieves the status of an approval request using its secret request token.
 *
 * The token cannot authorize board access while the request is pending.
 */
export async function getAccessRequestStatus(
  roomId: string,
  requestToken: string,
) {
  if (!requestToken || requestToken.length < 40 || requestToken.length > 128) {
    throw new GuestAccessError("Invalid access request token", 404);
  }

  const request = await prisma.boardAccessRequest.findUnique({
    where: {
      requestTokenHash: hashToken(requestToken),
    },
    include: {
      shareSettings: {
        select: {
          roomId: true,
          revokedAt: true,
          expiresAt: true,
        },
      },
      guestAccess: {
        select: {
          permission: true,
          expiresAt: true,
          revokedAt: true,
        },
      },
    },
  });

  if (!request) {
    throw new GuestAccessError("Access request not found", 404);
  }

  if (request.shareSettings.roomId !== roomId) {
    throw new GuestAccessError("Access request not found", 404);
  }

  if (
    request.status === BoardAccessRequestStatus.PENDING &&
    !isActive(request.shareSettings.revokedAt, request.shareSettings.expiresAt)
  ) {
    return { status: "EXPIRED" as const };
  }

  if (request.status === BoardAccessRequestStatus.REJECTED) {
    return { status: "REJECTED" as const };
  }

  if (request.status === BoardAccessRequestStatus.PENDING) {
    return { status: "PENDING" as const };
  }

  if (
    !request.guestAccess ||
    !isActive(request.guestAccess.revokedAt, request.guestAccess.expiresAt)
  ) {
    return { status: "EXPIRED" as const };
  }

  return {
    status: "APPROVED" as const,
    permission: request.guestAccess.permission,
    expiresAt: request.guestAccess.expiresAt,
  };
}

/**
 * Allows the board creator to approve or reject an access request.
 *
 * The caller must verify creator authorization before calling this function.
 */
export async function reviewAccessRequest(
  roomId: string,
  requestId: string,
  decision: "APPROVED" | "REJECTED",
  permission?: SharePermission,
) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.boardAccessRequest.findFirst({
      where: {
        id: requestId,
        shareSettings: {
          roomId,
        },
      },
      include: {
        shareSettings: true,
      },
    });

    if (!request) {
      throw new GuestAccessError("Access request not found", 404);
    }

    if (request.status !== BoardAccessRequestStatus.PENDING) {
      throw new GuestAccessError(
        "This access request has already been reviewed",
        409,
      );
    }

    if (
      !isActive(
        request.shareSettings.revokedAt,
        request.shareSettings.expiresAt,
      )
    ) {
      throw new GuestAccessError("The share link is expired or revoked", 409);
    }

    if (decision === "REJECTED") {
      const updated = await tx.boardAccessRequest.updateMany({
        where: {
          id: request.id,
          status: BoardAccessRequestStatus.PENDING,
        },
        data: {
          status: BoardAccessRequestStatus.REJECTED,
          reviewedAt: new Date(),
        },
      });

      if (updated.count !== 1) {
        throw new GuestAccessError(
          "This access request has already been reviewed",
          409,
        );
      }

      return { status: "REJECTED" as const };
    }

    const approvedPermission = permission ?? request.shareSettings.permission;

    // A Viewer link cannot be used to grant Editor access.
    if (
      request.shareSettings.permission === SharePermission.VIEWER &&
      approvedPermission === SharePermission.EDITOR
    ) {
      throw new GuestAccessError(
        "A Viewer share link cannot grant Editor access",
        400,
      );
    }

    const updated = await tx.boardAccessRequest.updateMany({
      where: {
        id: request.id,
        status: BoardAccessRequestStatus.PENDING,
      },
      data: {
        status: BoardAccessRequestStatus.APPROVED,
        reviewedAt: new Date(),
      },
    });

    if (updated.count !== 1) {
      throw new GuestAccessError(
        "This access request has already been reviewed",
        409,
      );
    }

    await tx.boardGuestAccess.create({
      data: {
        roomId,
        credentialHash: request.requestTokenHash,
        participantId: request.participantId,
        participantName: request.participantName,
        permission: approvedPermission,
        sourceShareSettingsId: request.shareSettingsId,
        sourceRequestId: request.id,
        expiresAt: request.shareSettings.expiresAt,
      },
    });

    return {
      status: "APPROVED" as const,
      permission: approvedPermission,
    };
  });
}

/**
 * Validates a persistent guest credential and returns its access permission.
 */
export async function validateGuestCredential(
  roomId: string,
  credential: string,
) {
  if (!credential || credential.length < 40 || credential.length > 128) {
    return null;
  }

  const access = await prisma.boardGuestAccess.findUnique({
    where: {
      credentialHash: hashToken(credential),
    },
    include: {
      sourceSettings: true,
      sourceInvite: true,
      sourceRequest: true,
    },
  });

  if (!access || access.roomId !== roomId) {
    return null;
  }

  if (!isActive(access.revokedAt, access.expiresAt)) {
    return null;
  }

  // Allow exactly one logical access source:
  // 1. Reusable share link
  // 2. Individual invitation
  // 3. Approved request linked to its reusable share settings
  const isInviteAccess =
    Boolean(access.sourceInviteId) &&
    !access.sourceShareSettingsId &&
    !access.sourceRequestId;

  const isShareLinkAccess =
    Boolean(access.sourceShareSettingsId) &&
    !access.sourceInviteId &&
    !access.sourceRequestId;

  const isApprovedRequestAccess =
    Boolean(access.sourceRequestId) &&
    Boolean(access.sourceShareSettingsId) &&
    !access.sourceInviteId;

  if (!isInviteAccess && !isShareLinkAccess && !isApprovedRequestAccess) {
    return null;
  }

  if (access.sourceShareSettingsId) {
    if (
      !access.sourceSettings ||
      access.sourceSettings.roomId !== roomId ||
      !isActive(
        access.sourceSettings.revokedAt,
        access.sourceSettings.expiresAt,
      )
    ) {
      return null;
    }
  }

  if (access.sourceInviteId) {
    if (
      !access.sourceInvite ||
      access.sourceInvite.roomId !== roomId ||
      !isActive(access.sourceInvite.revokedAt, access.sourceInvite.expiresAt)
    ) {
      return null;
    }
  }

  if (access.sourceRequestId) {
    if (
      !access.sourceRequest ||
      access.sourceRequest.status !== BoardAccessRequestStatus.APPROVED ||
      access.sourceRequest.shareSettingsId !== access.sourceShareSettingsId ||
      access.sourceRequest.shareSettingsId !== access.sourceSettings?.id ||
      access.sourceSettings?.roomId !== roomId
    ) {
      return null;
    }
  }

  const effectivePermission =
    access.sourceSettings?.permission === SharePermission.VIEWER
      ? SharePermission.VIEWER
      : access.permission;

  return {
    roomId: access.roomId,
    participantId: access.participantId,
    participantName: access.participantName,
    permission: effectivePermission,
    expiresAt: access.expiresAt,
  };
}
