"use client";

import { useEffect, useRef, useState } from "react";
import {
  Canvas,
  Point,
  PencilBrush,
  FabricObject,
  IText,
  Textbox,
  Rect,
  Circle,
  Triangle,
  Polygon,
  Line,
  Path,
} from "fabric";
import type {
  WhiteboardTool,
  ShapeType,
  HistoryControls,
} from "./board-workspace";
import { API_URL } from "@/lib/api";
import { socket } from "@/lib/socket";
import { getParticipantIdentity } from "@/lib/participant";

type WhiteboardCanvasProps = {
  roomId: string;
  activeTool: WhiteboardTool;
  selectedShape: ShapeType;
  onHistoryControlsChange: (controls: HistoryControls) => void;
};

type RoomParticipant = {
  id: string;
  name: string;
  color: string;
  socketId: string;
};

type RemoteCursor = {
  socketId: string;
  x: number;
  y: number;
};

type SaveStatus = "saved" | "saving" | "pending" | "error" | "conflict";
type BoardState = ReturnType<typeof createBoardState>;

class RevisionConflictError extends Error {
  currentRevision: number;

  constructor(currentRevision: number) {
    super(
      "This board was modified by another session. Your local changes have been preserved.",
    );
    this.name = "RevisionConflictError";
    this.currentRevision = currentRevision;
  }
}

const NOTE_COLORS = ["#FFF2A8", "#FFD6D6", "#D9F2E6", "#DCE8FF", "#EADCF8"];
const ERASER_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Cpath d='M7 18L16 5L25 11L16 24L7 18Z' fill='%23F2B8C6' stroke='%23252525' stroke-width='1.5'/%3E%3Cpath d='M7 18L16 24L12 28L3 22L7 18Z' fill='%23FFFFFF' stroke='%23252525' stroke-width='1.5'/%3E%3Cpath d='M12 28H25' stroke='%23252525' stroke-width='1.5'/%3E%3C/svg%3E\") 5 22, auto";

function createBoardState(canvas: Canvas) {
  return {
    version: 1,
    canvas: canvas.toJSON(),
    viewportTransform: canvas.viewportTransform
      ? [...canvas.viewportTransform]
      : [1, 0, 0, 1, 0, 0],
    zoom: canvas.getZoom(),
  };
}

async function persistBoard(
  roomId: string,
  boardState: BoardState,
  expectedRevision: number,
): Promise<{ localSaved: boolean; revision: number }> {
  const storageKey = `brainstorm-space-board:${roomId}`;
  const pendingKey = `brainstorm-space-pending:${roomId}`;
  const revisionKey = `brainstorm-space-revision:${roomId}`;

  let localSaved = true;

  // Preserve the latest board locally before cloud synchronization.
  try {
    const alreadyPending = localStorage.getItem(pendingKey) === "true";

    localStorage.setItem(storageKey, JSON.stringify(boardState));

    // Preserve the original base revision of an existing offline draft.
    if (!alreadyPending) {
      localStorage.setItem(revisionKey, String(expectedRevision));
    }

    localStorage.setItem(pendingKey, "true");
  } catch (error) {
    localSaved = false;
    console.error("Failed to save whiteboard locally:", error);
  }

  // Do not attempt a cloud save while offline.
  if (!navigator.onLine) {
    throw new Error(
      localSaved
        ? "Device is offline. Board saved locally."
        : "Device is offline and the local backup failed. Your latest changes may not be recoverable after closing this tab.",
    );
  }

  try {
    const response = await fetch(`${API_URL}/api/rooms/${roomId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        boardData: boardState,
        expectedRevision,
      }),
    });

    const result = await response.json();

    // A stale revision must never be retried as an ordinary save failure.
    if (
      response.status === 409 &&
      result.code === "REVISION_CONFLICT" &&
      Number.isInteger(result.currentRevision)
    ) {
      throw new RevisionConflictError(result.currentRevision);
    }

    if (!response.ok || !result.success) {
      throw new Error(result.message || "Cloud save failed");
    }

    const savedRevision = result.data?.revision;

    if (!Number.isInteger(savedRevision)) {
      throw new Error("Server returned an invalid board revision.");
    }

    // Clear pending metadata only after a successful database save.
    try {
      localStorage.removeItem(pendingKey);
      localStorage.removeItem(revisionKey);
    } catch (error) {
      localSaved = false;
      console.error("Failed to clear local pending metadata:", error);
    }

    console.log("Whiteboard saved to database. Revision:", savedRevision);

    return {
      localSaved,
      revision: savedRevision,
    };
  } catch (error) {
    // Preserve the custom conflict error for the save queue.
    if (error instanceof RevisionConflictError) {
      throw error;
    }

    const message =
      error instanceof Error ? error.message : "Cloud save failed";

    console.error("Failed to save whiteboard to cloud:", error);

    throw new Error(
      localSaved ? message : `${message}. The local backup also failed.`,
    );
  }
}

export default function WhiteboardCanvas({
  roomId,
  activeTool,
  selectedShape,
  onHistoryControlsChange,
}: WhiteboardCanvasProps) {
  const canvasElementRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<Canvas | null>(null);
  const saveInProgressRef = useRef(false);
  const pendingBoardStateRef = useRef<BoardState | null>(null);
  const retryRequestedRef = useRef(false);
  const roomRevisionRef = useRef(0);
  const revisionConflictRef = useRef(false);
  const skipCleanupFlushRef = useRef(false);
  const isRecoveryRestoreRef = useRef(false);

  // Undo/redo history.
  const historyRef = useRef<BoardState[]>([]);
  const historyIndexRef = useRef(-1);
  const isApplyingHistoryRef = useRef(false);
  const undoActionRef = useRef<(() => void) | null>(null);
  const redoActionRef = useRef<(() => void) | null>(null);

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Send current history availability and actions to the parent toolbar.
  useEffect(() => {
    onHistoryControlsChange({
      canUndo,
      canRedo,
      undo: () => undoActionRef.current?.(),
      redo: () => redoActionRef.current?.(),
    });
  }, [canUndo, canRedo, onHistoryControlsChange]);

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [saveError, setSaveError] = useState("");
  const [hasRecoveryDraft, setHasRecoveryDraft] = useState(false);

  const reloadLatestBoard = () => {
    if (!revisionConflictRef.current) return;

    if (saveInProgressRef.current) {
      setSaveError(
        "A save is still in progress. Please wait before reloading.",
      );
      return;
    }

    try {
      const canvas = canvasRef.current;

      const localDraft = canvas
        ? createBoardState(canvas)
        : pendingBoardStateRef.current;

      if (!localDraft) {
        setSaveError(
          "Unable to capture your local draft. Reload was cancelled.",
        );
        return;
      }

      // Preserve the conflicted draft separately before reloading.
      localStorage.setItem(
        `brainstorm-space-recovery:${roomId}`,
        JSON.stringify({
          boardState: localDraft,
          baseRevision: localStorage.getItem(
            `brainstorm-space-revision:${roomId}`,
          ),
          savedAt: new Date().toISOString(),
        }),
      );

      // Prevent cleanup from flushing the stale draft again.
      skipCleanupFlushRef.current = true;

      // Remove only pending-save metadata. Keep the recovery backup.
      localStorage.removeItem(`brainstorm-space-pending:${roomId}`);
      localStorage.removeItem(`brainstorm-space-revision:${roomId}`);

      window.location.reload();
    } catch (error) {
      console.error("Failed to preserve conflict recovery draft:", error);

      setSaveError(
        "Your recovery backup could not be created. Reload was cancelled to protect your local changes.",
      );
    }
  };

  const recoverLocalDraft = async () => {
    const canvas = canvasRef.current;

    if (!canvas) return;

    try {
      const recoveryKey = `brainstorm-space-recovery:${roomId}`;
      const savedRecovery = localStorage.getItem(recoveryKey);

      if (!savedRecovery) {
        setHasRecoveryDraft(false);
        setSaveError("No recovery draft was found in this browser.");
        return;
      }

      const recovery = JSON.parse(savedRecovery);
      const boardState = recovery?.boardState;

      if (
        !boardState ||
        typeof boardState !== "object" ||
        !boardState.canvas ||
        typeof boardState.canvas !== "object"
      ) {
        setSaveError("The recovery draft is invalid or corrupted.");
        return;
      }

      // Prevent Fabric.js restoration events from triggering autosave.
      isRecoveryRestoreRef.current = true;

      await canvas.loadFromJSON(boardState.canvas);

      if (boardState.viewportTransform) {
        const transform = boardState.viewportTransform;

        if (
          Array.isArray(transform) &&
          transform.length === 6 &&
          transform.every(
            (value) => typeof value === "number" && Number.isFinite(value),
          )
        ) {
          canvas.setViewportTransform(
            transform as [number, number, number, number, number, number],
          );
        }
      }

      if (
        typeof boardState.zoom === "number" &&
        Number.isFinite(boardState.zoom)
      ) {
        setZoom(boardState.zoom);
      }

      canvas.requestRenderAll();

      resetHistory(canvas);

      // Lock cloud saves after explicitly restoring the older draft.
      revisionConflictRef.current = true;
      pendingBoardStateRef.current = createBoardState(canvas);

      setSaveStatus("conflict");
      setSaveError(
        "Your recovery draft is restored locally. The latest server version remains protected. Review and copy any required content before resolving the conflict.",
      );
    } catch (error) {
      console.error("Failed to recover local draft:", error);
      setSaveError("Failed to restore the recovery draft.");
    } finally {
      isRecoveryRestoreRef.current = false;
    }
  };

  const saveLatestBoard = async (boardState: BoardState) => {
    // A revision conflict requires an explicit resolution.
    // Continue preserving newer edits locally without uploading them.
    if (revisionConflictRef.current) {
      pendingBoardStateRef.current = boardState;

      try {
        localStorage.setItem(
          `brainstorm-space-board:${roomId}`,
          JSON.stringify(boardState),
        );
        localStorage.setItem(`brainstorm-space-pending:${roomId}`, "true");
      } catch (error) {
        console.error("Failed to preserve conflicted board locally:", error);
      }

      return;
    }

    // If another save is running, keep only the newest pending state.
    if (saveInProgressRef.current) {
      pendingBoardStateRef.current = boardState;
      setSaveStatus("saving");

      try {
        localStorage.setItem(
          `brainstorm-space-board:${roomId}`,
          JSON.stringify(boardState),
        );
      } catch (error) {
        console.error("Failed to save whiteboard locally:", error);
      }

      return;
    }

    saveInProgressRef.current = true;
    setSaveStatus("saving");
    setSaveError("");

    let stateToSave: BoardState | null = boardState;
    let saveFailed = false;
    let conflictDetected = false;
    let localBackupWarning = false;

    try {
      while (stateToSave) {
        pendingBoardStateRef.current = null;

        try {
          const result = await persistBoard(
            roomId,
            stateToSave,
            roomRevisionRef.current,
          );

          // Advance the revision only after confirmed cloud success.
          roomRevisionRef.current = Math.max(
            roomRevisionRef.current,
            result.revision,
          );

          localBackupWarning = !result.localSaved;

          // Broadcast only after the database confirms this revision.
          if (socket.connected) {
            socket.emit("board-update", {
              roomId,
              boardState: stateToSave,
              revision: result.revision,
            });
          }

          if (!result.localSaved) {
            setSaveError(
              "Saved to cloud, but the local backup is unavailable.",
            );
          }
        } catch (error) {
          // Preserve the newest state, including edits queued during this save.
          pendingBoardStateRef.current ??= stateToSave;

          if (error instanceof RevisionConflictError) {
            conflictDetected = true;
            revisionConflictRef.current = true;

            // Record the server's latest revision, but do not overwrite it.
            roomRevisionRef.current = error.currentRevision;

            setSaveStatus("conflict");
            setSaveError(
              `${error.message} Your local draft is preserved. Reload the latest board or resolve the conflict before saving again.`,
            );

            console.error("Whiteboard revision conflict detected.", error);

            saveFailed = true;
            break;
          }

          const message =
            error instanceof Error
              ? error.message
              : "An unexpected error occurred while saving.";

          setSaveError(message);
          setSaveStatus(navigator.onLine ? "error" : "pending");

          console.error("Whiteboard synchronization is pending.", error);

          saveFailed = true;
          break;
        }

        // Never process another queued save after a remote conflict.
        if (revisionConflictRef.current) {
          saveFailed = true;
          break;
        }

        stateToSave = pendingBoardStateRef.current;
      }

      if (
        !saveFailed &&
        !pendingBoardStateRef.current &&
        !revisionConflictRef.current
      ) {
        setSaveStatus("saved");
        setSaveError(
          localBackupWarning
            ? "Saved to cloud, but the local backup is unavailable."
            : "",
        );
      }
    } finally {
      saveInProgressRef.current = false;

      // Retry only ordinary pending saves, never revision conflicts.
      if (retryRequestedRef.current) {
        retryRequestedRef.current = false;

        if (
          !conflictDetected &&
          !revisionConflictRef.current &&
          navigator.onLine &&
          pendingBoardStateRef.current
        ) {
          void saveLatestBoard(pendingBoardStateRef.current);
        }
      }
    }
  };

  // Keep Undo/Redo controls synchronized with the history position.
  const updateHistoryAvailability = () => {
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  };

  // Record a completed local board action.
  const recordHistorySnapshot = (canvas: Canvas) => {
    if (isApplyingHistoryRef.current) return;

    const snapshot = createBoardState(canvas);
    const previousSnapshot = historyRef.current[historyIndexRef.current];

    // Ignore duplicate snapshots, including intermediate Fabric events.
    if (
      previousSnapshot &&
      JSON.stringify(previousSnapshot.canvas) ===
        JSON.stringify(snapshot.canvas)
    ) {
      return;
    }

    // A new action after Undo discards the old redo branch.
    historyRef.current = historyRef.current.slice(
      0,
      historyIndexRef.current + 1,
    );

    // Keep an independent copy of the serialized canvas state.
    const savedSnapshot = JSON.parse(JSON.stringify(snapshot)) as BoardState;

    historyRef.current.push(savedSnapshot);

    // Limit memory usage to the latest 50 snapshots.
    if (historyRef.current.length > 50) {
      historyRef.current.shift();
    }

    historyIndexRef.current = historyRef.current.length - 1;

    updateHistoryAvailability();
  };

  // Establish a fresh history baseline after board restoration.
  const resetHistory = (canvas: Canvas) => {
    const snapshot = JSON.parse(
      JSON.stringify(createBoardState(canvas)),
    ) as BoardState;

    historyRef.current = [snapshot];
    historyIndexRef.current = 0;

    updateHistoryAvailability();
  };

  const retryPendingSave = () => {
    // A conflict cannot be resolved by retrying the same stale revision.
    if (revisionConflictRef.current) {
      return;
    }

    if (!navigator.onLine) {
      setSaveStatus("pending");
      setSaveError("Device is offline. Your changes are saved locally.");
      return;
    }

    // Remember the retry request if a save is already running.
    if (saveInProgressRef.current) {
      retryRequestedRef.current = true;
      return;
    }

    const pendingBoardState = pendingBoardStateRef.current;

    if (pendingBoardState) {
      void saveLatestBoard(pendingBoardState);
    }
  };

  const activeToolRef = useRef<WhiteboardTool>(activeTool);
  const selectedShapeRef = useRef<ShapeType>(selectedShape);

  const [zoom, setZoom] = useState(1);
  const [brushColor, setBrushColor] = useState("#252525");
  const [brushSize, setBrushSize] = useState(3);
  const [noteColor, setNoteColor] = useState(NOTE_COLORS[0]);
  const [shapeFill, setShapeFill] = useState("#F3EFF9");
  const [shapeStroke, setShapeStroke] = useState("#7256A8");
  const [shapeStrokeWidth, setShapeStrokeWidth] = useState(2);
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);

  const shapeFillRef = useRef(shapeFill);
  const shapeStrokeRef = useRef(shapeStroke);
  const shapeStrokeWidthRef = useRef(shapeStrokeWidth);
  const noteColorRef = useRef(noteColor);

  useEffect(() => {
    noteColorRef.current = noteColor;
  }, [noteColor]);

  useEffect(() => {
    selectedShapeRef.current = selectedShape;
  }, [selectedShape]);

  useEffect(() => {
    const element = canvasElementRef.current;

    if (!element) return;

    const wrapper = element.parentElement;

    if (!wrapper) return;

    const canvas = new Canvas(element, {
      width: wrapper.clientWidth,
      height: wrapper.clientHeight,
      selection: false,
      preserveObjectStacking: true,
      backgroundColor: "transparent",
      defaultCursor: "grab",
      hoverCursor: "default",
      isDrawingMode: false,
      perPixelTargetFind: true,
      targetFindTolerance: 8,
    });

    canvasRef.current = canvas;

    const brush = new PencilBrush(canvas);
    brush.width = 3;
    brush.color = "#252525";
    canvas.freeDrawingBrush = brush;

    let isPanning = false;
    let hasErasedObjects = false;
    let lastPointerX = 0;
    let lastPointerY = 0;

    let shapeBeingDrawn: FabricObject | null = null;
    let shapeStartPoint: Point | null = null;

    let isRestoring = false;
    let isApplyingRemoteChanges = false;
    let isDisposed = false;
    let saveTimeout: ReturnType<typeof setTimeout> | null = null;

    let lastCursorEmitTime = 0;

    const handlePointerMove = (event: PointerEvent) => {
      if (!socket.connected || isDisposed) return;

      const now = Date.now();

      // Limit cursor broadcasts to approximately 30 updates per second.
      if (now - lastCursorEmitTime < 33) return;

      lastCursorEmitTime = now;

      const bounds = wrapper.getBoundingClientRect();

      if (!bounds.width || !bounds.height) return;

      const x = (event.clientX - bounds.left) / bounds.width;
      const y = (event.clientY - bounds.top) / bounds.height;

      if (x < 0 || x > 1 || y < 0 || y > 1) return;

      socket.emit("cursor-move", {
        roomId,
        x,
        y,
      });
    };

    const saveBoard = () => {
      if (
        isRestoring ||
        isApplyingRemoteChanges ||
        isRecoveryRestoreRef.current ||
        isApplyingHistoryRef.current ||
        isDisposed
      ) {
        return;
      }

      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }

      saveTimeout = setTimeout(() => {
        saveTimeout = null;

        if (
          isDisposed ||
          isApplyingRemoteChanges ||
          isRecoveryRestoreRef.current ||
          isApplyingHistoryRef.current
        ) {
          return;
        }

        const boardState = createBoardState(canvas);

        // Save locally and serialize cloud saves.
        // Successful saves are broadcast by saveLatestBoard().
        void saveLatestBoard(boardState);
      }, 300);
    };

    // Restore a history snapshot without recording the restoration as a new action.
    const applyHistorySnapshot = async (nextIndex: number) => {
      if (
        isApplyingHistoryRef.current ||
        nextIndex < 0 ||
        nextIndex >= historyRef.current.length
      ) {
        return;
      }

      const snapshot = historyRef.current[nextIndex];

      if (!snapshot) return;

      // Cancel any pending autosave before restoring the selected snapshot.
      if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
      }

      // Preserve the current viewport because pan and zoom are not history actions.
      const currentViewportTransform: [
        number,
        number,
        number,
        number,
        number,
        number,
      ] = canvas.viewportTransform
        ? ([...canvas.viewportTransform] as [
            number,
            number,
            number,
            number,
            number,
            number,
          ])
        : [1, 0, 0, 1, 0, 0];

      let restored = false;

      isApplyingHistoryRef.current = true;

      try {
        await canvas.loadFromJSON(snapshot.canvas);

        canvas.setViewportTransform(currentViewportTransform);
        canvas.requestRenderAll();

        historyIndexRef.current = nextIndex;
        updateHistoryAvailability();

        setZoom(canvas.getZoom());

        restored = true;
      } catch (error) {
        console.error("Failed to restore whiteboard history:", error);
        setSaveError("Undo/Redo could not restore this board state.");
      } finally {
        isApplyingHistoryRef.current = false;
      }

      // Persist only after a successful restoration.
      if (restored) {
        void saveLatestBoard(createBoardState(canvas));
      }
    };

    undoActionRef.current = () => {
      void applyHistorySnapshot(historyIndexRef.current - 1);
    };

    redoActionRef.current = () => {
      void applyHistorySnapshot(historyIndexRef.current + 1);
    };

    const handlePresenceUpdate = (updatedParticipants: RoomParticipant[]) => {
      if (!Array.isArray(updatedParticipants)) return;

      setParticipants(updatedParticipants);

      // Remove cursors belonging to participants who have left.
      const activeSocketIds = new Set(
        updatedParticipants.map((participant) => participant.socketId),
      );

      setRemoteCursors((currentCursors) =>
        currentCursors.filter((cursor) => activeSocketIds.has(cursor.socketId)),
      );
    };

    // Receive cursor positions from other participants.
    const handleCursorUpdate = (cursor: RemoteCursor) => {
      if (
        !cursor ||
        typeof cursor.socketId !== "string" ||
        typeof cursor.x !== "number" ||
        typeof cursor.y !== "number" ||
        !Number.isFinite(cursor.x) ||
        !Number.isFinite(cursor.y) ||
        cursor.x < 0 ||
        cursor.x > 1 ||
        cursor.y < 0 ||
        cursor.y > 1
      ) {
        return;
      }

      setRemoteCursors((currentCursors) => {
        const existing = currentCursors.find(
          (item) => item.socketId === cursor.socketId,
        );

        if (existing) {
          return currentCursors.map((item) =>
            item.socketId === cursor.socketId ? cursor : item,
          );
        }

        return [...currentCursors, cursor];
      });
    };

    // Apply board updates received from other participants.

    const handleRemoteBoardUpdate = async (payload: {
      boardState?: unknown;
      revision?: unknown;
    }) => {
      const boardState = payload?.boardState;
      const incomingRevision = payload?.revision;

      // Validate the committed revision.
      if (
        typeof incomingRevision !== "number" ||
        !Number.isInteger(incomingRevision) ||
        incomingRevision < 1 ||
        incomingRevision <= roomRevisionRef.current
      ) {
        return;
      }

      if (
        !boardState ||
        typeof boardState !== "object" ||
        Array.isArray(boardState)
      ) {
        return;
      }

      const state = boardState as {
        canvas?: Record<string, unknown>;
        viewportTransform?: unknown;
        zoom?: unknown;
      };

      if (!state.canvas || typeof state.canvas !== "object") {
        return;
      }

      // Never overwrite a board with local changes that have not
      // been synchronized with the database.
      const hasLocalPendingSave =
        localStorage.getItem(`brainstorm-space-pending:${roomId}`) === "true";

      const hasUncommittedLocalChanges =
        hasLocalPendingSave ||
        saveInProgressRef.current ||
        pendingBoardStateRef.current !== null ||
        saveTimeout !== null ||
        revisionConflictRef.current;

      if (hasUncommittedLocalChanges) {
        const baseRevision = roomRevisionRef.current;

        // Capture the current canvas, including edits still inside
        // the autosave debounce window.
        const latestLocalState =
          pendingBoardStateRef.current ?? createBoardState(canvas);

        pendingBoardStateRef.current = latestLocalState;

        let localDraftPreserved = false;

        try {
          // Preserve the original base revision of the local draft.
          if (!hasLocalPendingSave) {
            localStorage.setItem(
              `brainstorm-space-revision:${roomId}`,
              String(baseRevision),
            );
          }

          localStorage.setItem(
            `brainstorm-space-board:${roomId}`,
            JSON.stringify(latestLocalState),
          );

          localStorage.setItem(`brainstorm-space-pending:${roomId}`, "true");

          localDraftPreserved = true;
        } catch (error) {
          console.error("Failed to preserve local draft:", error);
        }

        revisionConflictRef.current = true;
        roomRevisionRef.current = incomingRevision;

        setSaveStatus("conflict");
        setSaveError(
          localDraftPreserved
            ? "Another participant saved a newer board version. Your local changes are preserved and have not been overwritten."
            : "Another participant saved a newer board version. Local backup failed; your current changes remain in this browser session. Do not close or refresh this tab.",
        );

        console.warn(
          "Remote update deferred because local changes are pending.",
        );

        return;
      }

      if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
      }

      isApplyingRemoteChanges = true;

      try {
        await canvas.loadFromJSON(state.canvas);

        if (isDisposed) return;

        const transform = state.viewportTransform;

        if (
          Array.isArray(transform) &&
          transform.length === 6 &&
          transform.every(
            (value) => typeof value === "number" && Number.isFinite(value),
          )
        ) {
          canvas.setViewportTransform(
            transform as [number, number, number, number, number, number],
          );
        }

        if (typeof state.zoom === "number" && Number.isFinite(state.zoom)) {
          setZoom(state.zoom);
        }

        canvas.requestRenderAll();
        resetHistory(canvas);

        localStorage.setItem(
          `brainstorm-space-board:${roomId}`,
          JSON.stringify(state),
        );

        // Accept the revision only after successfully applying the update.
        roomRevisionRef.current = incomingRevision;

        console.log(`Remote whiteboard revision ${incomingRevision} applied.`);
      } catch (error) {
        console.error("Failed to apply remote board update:", error);
      } finally {
        isApplyingRemoteChanges = false;
      }
    };

    // Restore the saved board for this room.
    const restoreBoard = async () => {
      const storageKey = `brainstorm-space-board:${roomId}`;
      const pendingKey = `brainstorm-space-pending:${roomId}`;
      const revisionKey = `brainstorm-space-revision:${roomId}`;

      isRestoring = true;

      try {
        let boardState: {
          version?: number;
          canvas?: Record<string, unknown>;
          viewportTransform?: unknown;
          zoom?: unknown;
        } | null = null;

        let restoredFromLocalStorage = false;
        let hasValidBaseRevision = false;
        // Detect an older conflict recovery draft without restoring it automatically.
        const recoveryKey = `brainstorm-space-recovery:${roomId}`;
        const savedRecovery = localStorage.getItem(recoveryKey);

        if (savedRecovery) {
          try {
            const recovery = JSON.parse(savedRecovery);

            if (
              recovery?.boardState &&
              typeof recovery.boardState === "object" &&
              recovery.boardState.canvas &&
              typeof recovery.boardState.canvas === "object"
            ) {
              setHasRecoveryDraft(true);
            }
          } catch (error) {
            console.error("Failed to validate recovery draft:", error);
          }
        }

        const hasPendingSave = localStorage.getItem(pendingKey) === "true";

        // 1. Restore a pending local draft before considering cloud data.
        if (hasPendingSave) {
          const saved = localStorage.getItem(storageKey);

          if (saved) {
            try {
              const parsed = JSON.parse(saved);

              if (parsed?.canvas && typeof parsed.canvas === "object") {
                boardState = parsed;
                restoredFromLocalStorage = true;

                const storedRevision = localStorage.getItem(revisionKey);
                const parsedRevision =
                  storedRevision !== null ? Number(storedRevision) : NaN;

                if (Number.isInteger(parsedRevision) && parsedRevision >= 0) {
                  roomRevisionRef.current = parsedRevision;
                  hasValidBaseRevision = true;
                }

                console.log(
                  "Restoring unsynchronized local whiteboard changes.",
                );
              }
            } catch (error) {
              console.error("Failed to parse pending local board:", error);
            }
          }
        }

        // 2. Fetch the server board and its current revision.
        // A pending local draft keeps priority over the server board.
        let serverRevision: number | null = null;

        try {
          const response = await fetch(`${API_URL}/api/rooms/${roomId}`);
          const result = await response.json();

          if (!response.ok || !result.success) {
            throw new Error(result.message || "Failed to load room");
          }

          const revision = result.data?.revision;

          if (Number.isInteger(revision) && revision >= 0) {
            serverRevision = revision;
          } else {
            throw new Error("Server returned an invalid board revision.");
          }

          if (!boardState) {
            const serverBoard = result.data?.boardData;

            if (
              serverBoard &&
              typeof serverBoard === "object" &&
              serverBoard.canvas &&
              typeof serverBoard.canvas === "object"
            ) {
              boardState = serverBoard;
            }

            if (serverRevision !== null) {
              roomRevisionRef.current = serverRevision;
            }
          }
        } catch (error) {
          console.error("Failed to load board from cloud:", error);
        }

        if (isDisposed) return;

        // 3. A pending draft without a valid base revision cannot be
        // safely synchronized. Preserve it and require conflict resolution.
        if (
          hasPendingSave &&
          (!hasValidBaseRevision || serverRevision === null)
        ) {
          revisionConflictRef.current = true;

          if (serverRevision !== null) {
            roomRevisionRef.current = serverRevision;
          }

          setSaveStatus("conflict");
          setSaveError(
            "Your local draft is preserved, but its original server revision could not be verified. Reload the latest board or resolve the draft manually before saving.",
          );
        } else if (
          hasPendingSave &&
          serverRevision !== null &&
          roomRevisionRef.current !== serverRevision
        ) {
          revisionConflictRef.current = true;
          roomRevisionRef.current = serverRevision;

          setSaveStatus("conflict");
          setSaveError(
            "Another participant saved a newer board version. Your local draft is preserved and has not been overwritten. Reload the latest board or resolve the conflict before saving again.",
          );
        }

        // 4. Fall back to localStorage if the database has no saved board.
        if (!boardState) {
          const saved = localStorage.getItem(storageKey);

          if (saved) {
            try {
              const parsed = JSON.parse(saved);

              if (parsed?.canvas && typeof parsed.canvas === "object") {
                boardState = parsed;
                restoredFromLocalStorage = true;
              }
            } catch (error) {
              console.error("Failed to parse local board:", error);
            }
          }
        }

        // 5. Restore the selected board state.
        if (isDisposed) {
          return;
        }

        if (!boardState?.canvas) {
          // Establish the empty board as the initial Undo/Redo snapshot.
          canvas.requestRenderAll();
          resetHistory(canvas);
          return;
        }

        await canvas.loadFromJSON(boardState.canvas);

        if (isDisposed) return;

        const transform = boardState.viewportTransform;

        if (
          Array.isArray(transform) &&
          transform.length === 6 &&
          transform.every(
            (value) => typeof value === "number" && Number.isFinite(value),
          )
        ) {
          canvas.setViewportTransform(
            transform as [number, number, number, number, number, number],
          );
        }

        if (
          typeof boardState.zoom === "number" &&
          Number.isFinite(boardState.zoom)
        ) {
          setZoom(boardState.zoom);
        }

        canvas.requestRenderAll();
        resetHistory(canvas);

        // 6. Keep localStorage synchronized with the restored state.
        if (!hasPendingSave) {
          localStorage.setItem(storageKey, JSON.stringify(boardState));
        }

        // 7. Synchronize only a valid local draft whose base revision
        // still matches the server.
        if (
          restoredFromLocalStorage &&
          !isDisposed &&
          !revisionConflictRef.current
        ) {
          console.log(
            "Synchronizing restored local board data with the database...",
          );
          void saveLatestBoard(createBoardState(canvas));
        }

        console.log("Whiteboard restored successfully.");
      } catch (error) {
        console.error("Failed to restore whiteboard:", error);
      } finally {
        isRestoring = false;
      }
    };

    const handleSocketConnect = () => {
      if (isDisposed) return;

      const participant = getParticipantIdentity();

      socket.emit("join-room", { roomId, participant });

      console.log(`Connected to whiteboard room: ${roomId}`);

      retryPendingSave();
    };

    const handleOnline = () => {
      console.log(
        "Network connection restored. Retrying pending whiteboard save.",
      );
      retryPendingSave();
    };

    void restoreBoard().then(() => {
      if (isDisposed) return;

      window.addEventListener("online", handleOnline);

      socket.on("board-update", handleRemoteBoardUpdate);
      socket.on("presence-update", handlePresenceUpdate);
      socket.on("cursor-update", handleCursorUpdate);
      socket.on("connect", handleSocketConnect);

      if (socket.connected) {
        handleSocketConnect();
      } else {
        socket.connect();
      }
    });

    const eraseTarget = (target: unknown) => {
      if (!target || typeof target !== "object") return;

      const fabricTarget = target as FabricObject;

      // The eraser only removes freehand drawing paths.
      if (fabricTarget.type === "path") {
        canvas.remove(fabricTarget);
        hasErasedObjects = true;
        canvas.requestRenderAll();
      }
    };

    const createStickyNote = (pointerEvent: MouseEvent) => {
      const pointer = canvas.getScenePoint(pointerEvent);

      const note = new Textbox("Add your idea...", {
        left: pointer.x,
        top: pointer.y,
        width: 190,
        fontSize: 17,
        fontFamily: "Arial",
        fontWeight: "normal",
        fill: "#252525",
        backgroundColor: noteColorRef.current,
        padding: 16,
        textAlign: "left",
        editable: true,
        selectable: true,
        hasControls: true,
        hasBorders: true,
        cornerColor: "#7256A8",
        borderColor: "#7256A8",
        transparentCorners: false,
        lockRotation: true,
      });

      canvas.add(note);
      canvas.setActiveObject(note);
      note.enterEditing();
      note.selectAll();
      canvas.requestRenderAll();
    };

    const createTextObject = (pointerEvent: MouseEvent) => {
      const pointer = canvas.getScenePoint(pointerEvent);

      const text = new IText("Type something...", {
        left: pointer.x,
        top: pointer.y,
        fontSize: 24,
        fontFamily: "Arial",
        fill: "#252525",
        editable: true,
        selectable: true,
        hasControls: true,
        hasBorders: true,
        cornerColor: "#7256A8",
        borderColor: "#7256A8",
        transparentCorners: false,
        lockRotation: true,
      });

      canvas.add(text);
      canvas.setActiveObject(text);
      text.enterEditing();
      text.selectAll();
      canvas.requestRenderAll();
    };

    const createShape = (
      type: ShapeType,
      start: Point,
      end: Point,
    ): FabricObject => {
      const left = Math.min(start.x, end.x);
      const top = Math.min(start.y, end.y);
      const width = Math.abs(end.x - start.x);
      const height = Math.abs(end.y - start.y);

      const common = {
        fill: shapeFillRef.current,
        stroke: shapeStrokeRef.current,
        strokeWidth: shapeStrokeWidthRef.current,
        selectable: true,
        hasControls: true,
        hasBorders: true,
        cornerColor: "#7256A8",
        borderColor: "#7256A8",
        transparentCorners: false,
        lockRotation: true,
      };

      switch (type) {
        case "rectangle":
          return new Rect({
            ...common,
            left,
            top,
            width,
            height,
          });

        case "square": {
          const size = Math.max(width, height);
          return new Rect({
            ...common,
            left: start.x <= end.x ? start.x : start.x - size,
            top: start.y <= end.y ? start.y : start.y - size,
            width: size,
            height: size,
          });
        }

        case "circle":
          return new Circle({
            ...common,
            left,
            top,
            radius: Math.max(width, height) / 2,
          });

        case "triangle":
          return new Triangle({
            ...common,
            left,
            top,
            width,
            height,
          });

        case "hexagon": {
          const points = Array.from({ length: 6 }, (_, index) => {
            const angle = (Math.PI / 3) * index - Math.PI / 2;
            return {
              x: width / 2 + (width / 2) * Math.cos(angle),
              y: height / 2 + (height / 2) * Math.sin(angle),
            };
          });

          return new Polygon(points, {
            ...common,
            left,
            top,
            width,
            height,
          });
        }

        case "callout": {
          const tail = Math.min(18, width / 5, height / 4);

          const points = [
            { x: 0, y: 0 },
            { x: width, y: 0 },
            { x: width, y: height - tail },
            { x: width * 0.65, y: height - tail },
            { x: width * 0.5, y: height },
            { x: width * 0.4, y: height - tail },
            { x: 0, y: height - tail },
          ];

          return new Polygon(points, {
            ...common,
            left,
            top,
            width,
            height,
          });
        }

        case "arrow": {
          const shaft = new Path(
            `M 0 0 L ${width} ${height} M ${width - 14} ${height - 14} L ${width} ${height} L ${width - 14} ${height + 14}`,
            {
              ...common,
              left,
              top,
              fill: "",
              stroke: "#7256A8",
              strokeWidth: 3,
            },
          );

          return shaft;
        }

        case "line":
          return new Line([0, 0, width, height], {
            ...common,
            left,
            top,
            fill: "",
            stroke: "#7256A8",
            strokeWidth: 2,
          });

        default:
          return new Rect({
            ...common,
            left,
            top,
            width,
            height,
          });
      }
    };

    const handleMouseDown = (event: {
      e: MouseEvent | TouchEvent;
      target?: unknown;
    }) => {
      if (canvas.isDrawingMode) return;

      const pointerEvent = event.e as MouseEvent;
      const currentTool = activeToolRef.current;

      if (currentTool === "erase") {
        eraseTarget(event.target);
        return;
      }

      if (currentTool === "note" && !event.target) {
        createStickyNote(pointerEvent);
        return;
      }

      if (currentTool === "text" && !event.target) {
        createTextObject(pointerEvent);
        return;
      }
      // Start drawing the selected shape.
      if (currentTool === "shape" && !event.target) {
        const pointer = canvas.getScenePoint(pointerEvent);

        shapeStartPoint = new Point(pointer.x, pointer.y);

        shapeBeingDrawn = createShape(
          selectedShapeRef.current,
          shapeStartPoint,
          shapeStartPoint,
        );

        canvas.add(shapeBeingDrawn);
        canvas.setActiveObject(shapeBeingDrawn);

        return;
      }

      // Let Fabric handle clicks on existing objects.
      if (event.target) return;

      // Only Select mode pans the canvas.
      if (currentTool !== "select") return;

      isPanning = true;
      lastPointerX = pointerEvent.clientX;
      lastPointerY = pointerEvent.clientY;

      canvas.setCursor("grabbing");
      canvas.selection = false;
    };

    const handleMouseMove = (event: {
      e: MouseEvent | TouchEvent;
      target?: unknown;
    }) => {
      if (activeToolRef.current === "erase") {
        eraseTarget(event.target);
        return;
      }
      // Update the selected shape while dragging.
      if (shapeBeingDrawn && shapeStartPoint) {
        const pointer = canvas.getScenePoint(event.e as MouseEvent);

        const replacement = createShape(
          selectedShapeRef.current,
          shapeStartPoint,
          new Point(pointer.x, pointer.y),
        );

        const index = canvas.getObjects().indexOf(shapeBeingDrawn);

        if (index !== -1) {
          canvas.remove(shapeBeingDrawn);
          canvas.insertAt(index, replacement);
        }

        shapeBeingDrawn = replacement;
        canvas.setActiveObject(replacement);
        replacement.setCoords();
        canvas.requestRenderAll();

        return;
      }

      if (!isPanning || canvas.isDrawingMode) return;

      const pointerEvent = event.e as MouseEvent;
      const viewport = canvas.viewportTransform;

      if (!viewport) return;

      const deltaX = pointerEvent.clientX - lastPointerX;
      const deltaY = pointerEvent.clientY - lastPointerY;

      viewport[4] += deltaX;
      viewport[5] += deltaY;

      lastPointerX = pointerEvent.clientX;
      lastPointerY = pointerEvent.clientY;

      canvas.requestRenderAll();
    };

    const handleMouseUp = () => {
      // Finish drawing the selected shape.
      if (shapeBeingDrawn) {
        const bounds = shapeBeingDrawn.getBoundingRect();

        if (bounds.width < 5 || bounds.height < 5) {
          canvas.remove(shapeBeingDrawn);
        } else {
          shapeBeingDrawn.setCoords();
          canvas.setActiveObject(shapeBeingDrawn);
          recordHistorySnapshot(canvas);
          saveBoard();
        }

        shapeBeingDrawn = null;
        shapeStartPoint = null;
      }
      if (isPanning) {
        saveBoard();
      }

      if (hasErasedObjects) {
        recordHistorySnapshot(canvas);
        saveBoard();
        hasErasedObjects = false;
      }

      isPanning = false;

      const currentTool = activeToolRef.current;

      const cursor =
        currentTool === "select"
          ? "grab"
          : currentTool === "erase"
            ? ERASER_CURSOR
            : "crosshair";

      canvas.setCursor(cursor);
      canvas.selection = false;
    };

    const handleMouseWheel = (event: { e: WheelEvent }) => {
      const wheelEvent = event.e;

      wheelEvent.preventDefault();
      wheelEvent.stopPropagation();

      const currentZoom = canvas.getZoom();

      let nextZoom = currentZoom * Math.pow(0.999, wheelEvent.deltaY);

      nextZoom = Math.min(3, Math.max(0.2, nextZoom));

      const pointer = canvas.getViewportPoint(wheelEvent);

      canvas.zoomToPoint(new Point(pointer.x, pointer.y), nextZoom);

      setZoom(nextZoom);
      saveBoard();
    };

    // Delete the currently selected note or text object.
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;

      // Do not intercept keyboard shortcuts inside form fields.
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      const activeObject = canvas.getActiveObject();

      // Preserve Fabric's native text editing shortcuts.
      if (activeObject instanceof IText && activeObject.isEditing) {
        return;
      }

      const key = event.key.toLowerCase();
      const isModifierPressed = event.ctrlKey || event.metaKey;

      // Undo: Ctrl+Z / Cmd+Z
      if (isModifierPressed && key === "z" && !event.shiftKey) {
        event.preventDefault();
        undoActionRef.current?.();
        return;
      }

      // Redo: Ctrl+Shift+Z / Cmd+Shift+Z / Ctrl+Y / Cmd+Y
      if (
        isModifierPressed &&
        ((key === "z" && event.shiftKey) || key === "y")
      ) {
        event.preventDefault();
        redoActionRef.current?.();
        return;
      }

      // Preserve existing Delete/Backspace behavior.
      if (event.key !== "Delete" && event.key !== "Backspace") return;

      if (!activeObject) return;

      const deletableTypes = [
        "textbox",
        "i-text",
        "rect",
        "circle",
        "triangle",
        "polygon",
        "line",
        "path",
      ];

      if (!deletableTypes.includes(activeObject.type)) {
        return;
      }

      canvas.remove(activeObject);
      canvas.discardActiveObject();
      canvas.requestRenderAll();

      recordHistorySnapshot(canvas);
      saveBoard();
    };

    // Record completed object transformations.
    const handleObjectModified = () => {
      recordHistorySnapshot(canvas);
      saveBoard();
    };

    // Record each completed freehand stroke once.
    const handlePathCreated = () => {
      recordHistorySnapshot(canvas);
      saveBoard();
    };

    // Record text creation or editing when the user exits text editing.
    const handleTextEditingExited = () => {
      recordHistorySnapshot(canvas);
      saveBoard();
    };

    // Finish text editing when the user clicks outside the whiteboard.
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Node)) return;
      if (wrapper.contains(target)) return;

      const activeObject = canvas.getActiveObject();

      if (
        (activeObject instanceof IText || activeObject instanceof Textbox) &&
        activeObject.isEditing
      ) {
        activeObject.exitEditing();
      }
    };

    canvas.on("mouse:down", handleMouseDown);
    canvas.on("mouse:move", handleMouseMove);
    canvas.on("mouse:up", handleMouseUp);
    canvas.on("mouse:wheel", handleMouseWheel);
    // Automatically save changes to the board.
    canvas.on("object:added", saveBoard);
    canvas.on("object:modified", handleObjectModified);
    canvas.on("object:removed", saveBoard);
    canvas.on("path:created", handlePathCreated);
    canvas.on("text:changed", saveBoard);
    canvas.on("text:editing:exited", handleTextEditingExited);

    window.addEventListener("keydown", handleKeyDown);
    wrapper.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerdown", handleOutsidePointerDown);

    const resizeObserver = new ResizeObserver(() => {
      canvas.setDimensions({
        width: wrapper.clientWidth,
        height: wrapper.clientHeight,
      });

      canvas.requestRenderAll();
    });

    resizeObserver.observe(wrapper);

    return () => {
      isDisposed = true;

      socket.off("board-update", handleRemoteBoardUpdate);
      socket.off("presence-update", handlePresenceUpdate);
      socket.off("cursor-update", handleCursorUpdate);
      socket.off("connect", handleSocketConnect);

      window.removeEventListener("online", handleOnline);

      if (socket.connected) {
        socket.emit("leave-room", roomId);
      }

      socket.disconnect();

      resizeObserver.disconnect();
      window.removeEventListener("keydown", handleKeyDown);
      wrapper.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerdown", handleOutsidePointerDown);

      canvas.off("mouse:down", handleMouseDown);
      canvas.off("mouse:move", handleMouseMove);
      canvas.off("mouse:up", handleMouseUp);
      canvas.off("mouse:wheel", handleMouseWheel);

      if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;

        // Flush pending changes unless a conflict reload is in progress.
        if (
          !skipCleanupFlushRef.current &&
          !isRestoring &&
          !isApplyingRemoteChanges
        ) {
          const boardState = createBoardState(canvas);
          void saveLatestBoard(boardState);
        }
      }

      canvas.off("object:added", saveBoard);
      canvas.off("object:modified", handleObjectModified);
      canvas.off("object:removed", saveBoard);
      canvas.off("path:created", handlePathCreated);
      canvas.off("text:changed", saveBoard);
      canvas.off("text:editing:exited", handleTextEditingExited);

      canvasRef.current = null;

      void canvas.dispose();
    };
  }, [roomId]);

  // Synchronize the selected toolbar tool with Fabric.js.
  useEffect(() => {
    activeToolRef.current = activeTool;

    const canvas = canvasRef.current;

    if (!canvas) return;

    const drawingEnabled = activeTool === "draw";

    canvas.isDrawingMode = drawingEnabled;
    canvas.selection = false;

    const cursor =
      activeTool === "select"
        ? "grab"
        : activeTool === "erase"
          ? ERASER_CURSOR
          : "crosshair";

    canvas.defaultCursor = cursor;
    canvas.hoverCursor = cursor;
    canvas.freeDrawingCursor = cursor;

    canvas.setCursor(cursor);
    canvas.upperCanvasEl.style.cursor = cursor;
    canvas.wrapperEl.style.cursor = cursor;

    canvas.requestRenderAll();
  }, [activeTool]);
  const changeBrushColor = (color: string) => {
    const canvas = canvasRef.current;

    if (!canvas?.freeDrawingBrush) return;

    canvas.freeDrawingBrush.color = color;
    setBrushColor(color);
  };

  const changeBrushSize = (size: number) => {
    const canvas = canvasRef.current;

    if (!canvas?.freeDrawingBrush) return;

    canvas.freeDrawingBrush.width = size;
    setBrushSize(size);
  };

  const changeShapeFill = (color: string) => {
    shapeFillRef.current = color;
    setShapeFill(color);

    const canvas = canvasRef.current;
    const activeObject = canvas?.getActiveObject();

    if (canvas && activeObject) {
      if (activeObject.type !== "line" && activeObject.type !== "path") {
        activeObject.set("fill", color);
      }

      canvas.requestRenderAll();
      void saveLatestBoard(createBoardState(canvas));
    }
  };

  const changeShapeStroke = (color: string) => {
    shapeStrokeRef.current = color;
    setShapeStroke(color);

    const canvas = canvasRef.current;
    const activeObject = canvas?.getActiveObject();

    if (canvas && activeObject) {
      activeObject.set("stroke", color);
      canvas.requestRenderAll();
      void saveLatestBoard(createBoardState(canvas));
    }
  };

  const changeShapeStrokeWidth = (width: number) => {
    shapeStrokeWidthRef.current = width;
    setShapeStrokeWidth(width);

    const canvas = canvasRef.current;
    const activeObject = canvas?.getActiveObject();

    if (canvas && activeObject) {
      activeObject.set("strokeWidth", width);
      canvas.requestRenderAll();
      void saveLatestBoard(createBoardState(canvas));
    }
  };

  const changeZoom = (direction: "in" | "out") => {
    const canvas = canvasRef.current;

    if (!canvas) return;

    const currentZoom = canvas.getZoom();

    const nextZoom =
      direction === "in"
        ? Math.min(3, currentZoom + 0.1)
        : Math.max(0.2, currentZoom - 0.1);

    const center = new Point(canvas.getWidth() / 2, canvas.getHeight() / 2);

    canvas.zoomToPoint(center, nextZoom);

    setZoom(nextZoom);
    void saveLatestBoard(createBoardState(canvas));
  };

  const resetZoom = () => {
    const canvas = canvasRef.current;

    if (!canvas) return;

    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

    setZoom(1);
    void saveLatestBoard(createBoardState(canvas));
  };

  return (
    <section className="whiteboard-workspace">
      <div className="participant-presence">
        <span className="participant-count">{participants.length} online</span>

        <div className="participant-avatar-list">
          {participants.map((participant) => (
            <div
              key={participant.socketId}
              className="participant-avatar"
              style={{ backgroundColor: participant.color }}
              title={participant.name}
              aria-label={participant.name}
            >
              {participant.name.slice(0, 1).toUpperCase()}
            </div>
          ))}
        </div>
      </div>

      <div
        className={`whiteboard-save-status whiteboard-save-status--${saveStatus}`}
        role="status"
        aria-live="polite"
      >
        <span className="whiteboard-save-indicator" />

        <span className="whiteboard-save-label">
          {saveStatus === "saved" && "Saved"}
          {saveStatus === "saving" && "Saving..."}
          {saveStatus === "pending" && "Save pending"}
          {saveStatus === "error" && "Save failed"}
          {saveStatus === "conflict" && "Conflict detected"}
        </span>

        {saveError && (
          <span className="whiteboard-save-error">{saveError}</span>
        )}

        {(saveStatus === "error" || saveStatus === "pending") && (
          <button
            type="button"
            className="whiteboard-save-retry"
            onClick={retryPendingSave}
          >
            Retry
          </button>
        )}
        {saveStatus === "conflict" && (
          <button
            type="button"
            className="whiteboard-save-retry"
            onClick={reloadLatestBoard}
          >
            Reload latest board
          </button>
        )}

        {hasRecoveryDraft && (
          <button
            type="button"
            className="whiteboard-save-retry"
            onClick={recoverLocalDraft}
          >
            Recover local draft
          </button>
        )}
      </div>

      <div className="whiteboard-canvas-wrapper">
        <canvas ref={canvasElementRef} />

        <div className="remote-cursor-layer">
          {remoteCursors.map((cursor) => {
            const participant = participants.find(
              (item) => item.socketId === cursor.socketId,
            );

            if (!participant) return null;

            return (
              <div
                key={cursor.socketId}
                className="remote-cursor"
                style={{
                  left: `${cursor.x * 100}%`,
                  top: `${cursor.y * 100}%`,
                  color: participant.color,
                }}
              >
                <svg
                  width="20"
                  height="24"
                  viewBox="0 0 20 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M2 2L2 19L7 14L11 22L14 20L10 12L17 12L2 2Z"
                    fill={participant.color}
                    stroke="white"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                </svg>

                <span
                  className="remote-cursor-label"
                  style={{ backgroundColor: participant.color }}
                >
                  {participant.name}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="canvas-controls">
        <label className="canvas-color-control" title="Choose drawing color">
          <span className="canvas-color-label">Color</span>
          <input
            type="color"
            value={brushColor}
            onChange={(event) => changeBrushColor(event.target.value)}
            aria-label="Choose drawing color"
          />
        </label>

        {activeTool === "note" && (
          <label
            className="canvas-color-control"
            title="Choose sticky note color"
          >
            <span className="canvas-color-label">Note</span>
            <input
              type="color"
              value={noteColor}
              onChange={(event) => setNoteColor(event.target.value)}
              aria-label="Choose sticky note color"
            />
          </label>
        )}

        {activeTool === "shape" && (
          <>
            <label
              className="canvas-color-control"
              title="Choose shape fill color"
            >
              <span className="canvas-color-label">Fill</span>
              <input
                type="color"
                value={shapeFill}
                onChange={(event) => changeShapeFill(event.target.value)}
                aria-label="Choose shape fill color"
              />
            </label>

            <label
              className="canvas-color-control"
              title="Choose shape border color"
            >
              <span className="canvas-color-label">Border</span>
              <input
                type="color"
                value={shapeStroke}
                onChange={(event) => changeShapeStroke(event.target.value)}
                aria-label="Choose shape border color"
              />
            </label>

            <label
              className="canvas-brush-control"
              title="Adjust shape border width"
            >
              <span className="canvas-brush-label">Border width</span>

              <input
                type="range"
                min="1"
                max="10"
                step="1"
                value={shapeStrokeWidth}
                onChange={(event) =>
                  changeShapeStrokeWidth(Number(event.target.value))
                }
                aria-label="Shape border width"
              />

              <span className="canvas-brush-value">{shapeStrokeWidth}px</span>
            </label>
          </>
        )}

        <label className="canvas-brush-control" title="Adjust brush size">
          <span className="canvas-brush-label">Size</span>

          <input
            type="range"
            min="1"
            max="30"
            step="1"
            value={brushSize}
            onChange={(event) => changeBrushSize(Number(event.target.value))}
            aria-label="Brush size"
          />

          <span className="canvas-brush-value">{brushSize}px</span>
        </label>

        <button
          type="button"
          className="canvas-control-button"
          onClick={() => changeZoom("out")}
          aria-label="Zoom out"
          title="Zoom out"
        >
          −
        </button>

        <button
          type="button"
          className="canvas-zoom-level"
          onClick={resetZoom}
          title="Reset zoom"
        >
          {Math.round(zoom * 100)}%
        </button>

        <button
          type="button"
          className="canvas-control-button"
          onClick={() => changeZoom("in")}
          aria-label="Zoom in"
          title="Zoom in"
        >
          +
        </button>

        <button
          type="button"
          className="canvas-control-button canvas-reset-button"
          onClick={resetZoom}
          title="Reset canvas"
        >
          ⌖
        </button>
      </div>

      <div className="canvas-room-label">Board: {roomId.slice(0, 8)}</div>
    </section>
  );
}
