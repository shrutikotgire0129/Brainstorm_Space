"use client";

import { useState } from "react";
import WhiteboardCanvas from "./whiteboard-canvas";

type BoardWorkspaceProps = {
  roomId: string;
};

export type WhiteboardTool = "select" | "draw" | "erase";

export default function BoardWorkspace({ roomId }: BoardWorkspaceProps) {
  const [activeTool, setActiveTool] = useState<WhiteboardTool>("select");

  return (
    <>
      <div className="board-toolbar">
        <button
          type="button"
          className={`board-tool-button ${
            activeTool === "select" ? "active" : ""
          }`}
          title="Select and pan"
          aria-pressed={activeTool === "select"}
          onClick={() => setActiveTool("select")}
        >
          <span>↖</span>
          <span className="tool-label">Select</span>
        </button>

        <div className="board-toolbar-divider" />

        <button
          type="button"
          className={`board-tool-button ${
            activeTool === "draw" ? "active" : ""
          }`}
          title="Freehand drawing"
          aria-pressed={activeTool === "draw"}
          onClick={() => setActiveTool("draw")}
        >
          <span>✎</span>
          <span className="tool-label">Draw</span>
        </button>

        <button
          type="button"
          className={`board-tool-button ${
            activeTool === "erase" ? "active" : ""
          }`}
          title="Erase individual strokes"
          aria-pressed={activeTool === "erase"}
          onClick={() => setActiveTool("erase")}
        >
          <span>⌫</span>
          <span className="tool-label">Eraser</span>
        </button>

        <button
          type="button"
          className="board-tool-button"
          disabled
          title="Sticky notes coming in a later phase"
        >
          <span>▤</span>
          <span className="tool-label">Notes</span>
        </button>

        <button
          type="button"
          className="board-tool-button"
          disabled
          title="Shapes coming in a later phase"
        >
          <span>◇</span>
          <span className="tool-label">Shapes</span>
        </button>

        <button
          type="button"
          className="board-tool-button"
          disabled
          title="Text tool coming in a later phase"
        >
          <span>T</span>
          <span className="tool-label">Text</span>
        </button>
      </div>

      <WhiteboardCanvas roomId={roomId} activeTool={activeTool} />
    </>
  );
}
