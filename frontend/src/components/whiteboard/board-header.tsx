"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { API_URL } from "@/lib/api";
import { getRoomOwnerToken } from "@/lib/room-owner";

type BoardHeaderProps = {
  roomId: string;
  boardName: string;
  onBoardNameChange: (name: string) => void;
};

const subscribeToOwnerToken = () => () => {};

export default function BoardHeader({
  roomId,
  boardName,
  onBoardNameChange,
}: BoardHeaderProps) {
  const canRename = useSyncExternalStore(
    subscribeToOwnerToken,
    () => Boolean(getRoomOwnerToken(roomId)),
    () => false,
  );

  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState(boardName);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const skipNextBlurSaveRef = useRef(false);

  async function handleRename() {
    const trimmedName = editedName.trim();

    if (trimmedName === boardName) {
      setIsEditing(false);
      setError("");
      return;
    }

    if (!trimmedName) {
      setError("Board name cannot be empty.");
      return;
    }

    if (trimmedName.length > 100) {
      setError("Board name cannot exceed 100 characters.");
      return;
    }

    const ownerToken = getRoomOwnerToken(roomId);

    if (!ownerToken) {
      setError("Creator authorization is unavailable.");
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      const response = await fetch(`${API_URL}/api/rooms/${roomId}/name`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({ name: trimmedName }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to rename board.");
      }

      onBoardNameChange(result.data.name);
      setEditedName(result.data.name);
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename board.");
    } finally {
      setIsSaving(false);
    }
  }

  function handleBlur() {
    if (skipNextBlurSaveRef.current) {
      skipNextBlurSaveRef.current = false;
      return;
    }

    if (!isSaving) {
      void handleRename();
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }

    if (event.key === "Escape") {
      event.preventDefault();

      skipNextBlurSaveRef.current = true;
      setEditedName(boardName);
      setIsEditing(false);
      setError("");

      event.currentTarget.blur();
    }
  }

  return (
    <header className="board-header">
      <div className="board-header-left">
        <Link href="/" className="board-brand">
          <span className="brand-mark">B</span>
          <span>Brainstorm Space</span>
        </Link>

        <div className="board-header-divider" />

        <div className="board-title">
          <div className="board-title-name">
            {isEditing ? (
              <input
                type="text"
                value={editedName}
                maxLength={100}
                autoFocus
                disabled={isSaving}
                aria-label="Board name"
                onChange={(event) => setEditedName(event.target.value)}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
              />
            ) : (
              <span
                onDoubleClick={() => {
                  if (!canRename || isSaving) return;

                  setEditedName(boardName);
                  setIsEditing(true);
                  setError("");
                }}
                title={canRename ? "Double-click to rename" : undefined}
                style={{
                  cursor: canRename ? "text" : "default",
                }}
              >
                {boardName}
              </span>
            )}
          </div>

          {error && <span role="alert">{error}</span>}

          <span className="board-save-status">
            <span className="save-status-dot" />
            Local workspace
          </span>
        </div>
      </div>

      <div className="board-header-right">
        <span className="board-room-id">Room {roomId.slice(0, 8)}</span>

        <button
          type="button"
          className="board-share-button"
          disabled
          title="Sharing will be available in a later feature"
        >
          Share
        </button>
      </div>
    </header>
  );
}
