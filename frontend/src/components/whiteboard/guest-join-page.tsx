"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_URL } from "@/lib/api";
import { getParticipantIdentity } from "@/lib/participant";
import { saveGuestCredential } from "@/lib/guest-credential";

type Props = {
  roomId: string;
  token: string;
};

type JoinStatus = "loading" | "pending" | "rejected" | "expired" | "error";

type RedeemResponse = {
  success: boolean;
  message?: string;
  data?: {
    status: "GRANTED" | "PENDING";
    credential?: string;
    requestToken?: string;
  };
};

type RequestStatusResponse = {
  success: boolean;
  message?: string;
  data?: {
    status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
  };
};

export default function GuestJoinPage({ roomId, token }: Props) {
  const router = useRouter();

  const [status, setStatus] = useState<JoinStatus>("loading");
  const [message, setMessage] = useState("Validating your invitation...");

  useEffect(() => {
    let cancelled = false;
    let pollTimeout: ReturnType<typeof setTimeout> | null = null;
    let pollRetryDelay = 4000;

    const redirectToBoard = (credential: string) => {
      if (cancelled) return;

      try {
        saveGuestCredential(roomId, credential);
        router.replace(`/board/${roomId}`);
      } catch {
        setStatus("error");
        setMessage(
          "We couldn't save your guest access. Please enable browser storage and try again.",
        );
      }
    };

    const pollRequestStatus = async (requestToken: string) => {
      if (cancelled) return;

      try {
        const response = await fetch(
          `${API_URL}/api/rooms/${encodeURIComponent(roomId)}/guest-access/request-status`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ requestToken }),
          },
        );

        const result = (await response.json()) as RequestStatusResponse;

        if (!response.ok || !result.success || !result.data) {
          throw new Error(
            result.message || "Unable to check your access request.",
          );
        }

        if (cancelled) return;

        switch (result.data.status) {
          case "APPROVED":
            redirectToBoard(requestToken);
            return;

          case "REJECTED":
            setStatus("rejected");
            setMessage("The board owner declined your access request.");
            return;

          case "EXPIRED":
            setStatus("expired");
            setMessage(
              "This invitation or access request has expired or been revoked.",
            );
            return;

          case "PENDING":
            setStatus("pending");
            setMessage(
              "Your request has been sent. Waiting for the board owner to approve it...",
            );
            pollTimeout = setTimeout(() => {
              void pollRequestStatus(requestToken);
            }, 4000);
            return;
        }
      } catch {
        if (cancelled) return;

        setStatus("pending");
        setMessage(
          "Unable to check your request temporarily. Retrying automatically...",
        );

        pollRetryDelay = Math.min(pollRetryDelay * 2, 30000);

        pollTimeout = setTimeout(() => {
          void pollRequestStatus(requestToken);
        }, pollRetryDelay);
      }
    };

    const redeemInvitation = async () => {
      try {
        const participant = getParticipantIdentity();

        const response = await fetch(
          `${API_URL}/api/rooms/${encodeURIComponent(roomId)}/guest-access/redeem`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              token,
              participant: {
                id: participant.id,
                name: participant.name,
              },
            }),
          },
        );

        const result = (await response.json()) as RedeemResponse;

        if (!response.ok || !result.success || !result.data) {
          throw new Error(
            result.message || "This invitation could not be validated.",
          );
        }

        if (cancelled) return;

        if (result.data.status === "GRANTED") {
          if (!result.data.credential) {
            throw new Error("The server did not provide guest access.");
          }

          redirectToBoard(result.data.credential);
          return;
        }

        if (result.data.status === "PENDING") {
          if (!result.data.requestToken) {
            throw new Error(
              "The server did not provide an access request reference.",
            );
          }

          setStatus("pending");
          setMessage(
            "Your request has been sent. Waiting for the board owner to approve it...",
          );

          void pollRequestStatus(result.data.requestToken);
          clearTimeout(startTimeout);
        }
      } catch (error) {
        if (cancelled) return;

        setStatus("error");
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to join this board. Please check your invitation.",
        );
      }
    };

    const startTimeout = setTimeout(() => {
      void redeemInvitation();
    }, 0);

    return () => {
      cancelled = true;

      clearTimeout(startTimeout);

      if (pollTimeout) {
        clearTimeout(pollTimeout);
      }
    };
  }, [roomId, token, router]);

  const isWaiting = status === "loading" || status === "pending";

  return (
    <main className="guest-join-page">
      <section
        className="guest-join-card"
        aria-live="polite"
        aria-busy={isWaiting}
      >
        <div className="guest-join-logo" aria-hidden="true">
          B
        </div>

        <p className="guest-join-eyebrow">BRAINSTORM SPACE</p>

        <h1>
          {status === "loading" && "Joining board"}
          {status === "pending" && "Approval requested"}
          {status === "rejected" && "Access declined"}
          {status === "expired" && "Invitation unavailable"}
          {status === "error" && "Unable to join"}
        </h1>

        {isWaiting && <div className="guest-join-spinner" aria-hidden="true" />}

        <p className="guest-join-message">{message}</p>

        {status === "pending" && (
          <p className="guest-join-note">
            This page will update automatically when the owner reviews your
            request. You can keep this page open.
          </p>
        )}

        {(status === "rejected" ||
          status === "expired" ||
          status === "error") && (
          <button
            type="button"
            className="guest-join-button"
            onClick={() => router.replace("/")}
          >
            Return to home
          </button>
        )}
      </section>
    </main>
  );
}
