"use client";

import { useState } from "react";
import WhiteboardCanvas from "./whiteboard-canvas";

type BoardWorkspaceProps = {
  roomId: string;
};

export type WhiteboardTool =
  | "select"
  | "draw"
  | "erase"
  | "note"
  | "text"
  | "shape";

export type ShapeType =
  | "rectangle"
  | "square"
  | "circle"
  | "triangle"
  | "hexagon"
  | "callout"
  | "arrow"
  | "line";

export type HistoryControls = {
  canUndo: boolean;
  canRedo: boolean;
  isExporting: boolean;
  undo: () => void;
  redo: () => void;
  exportPng: () => void;
};

const SHAPES: { type: ShapeType; label: string; icon: string }[] = [
  { type: "rectangle", label: "Rectangle", icon: "▱" },
  { type: "square", label: "Square", icon: "□" },
  { type: "circle", label: "Circle", icon: "○" },
  { type: "triangle", label: "Triangle", icon: "△" },
  { type: "hexagon", label: "Hexagon", icon: "⬡" },
  { type: "callout", label: "Callout", icon: "▢" },
  { type: "arrow", label: "Arrow", icon: "→" },
  { type: "line", label: "Line", icon: "╱" },
];

export default function BoardWorkspace({ roomId }: BoardWorkspaceProps) {
  const [activeTool, setActiveTool] = useState<WhiteboardTool>("select");
  const [selectedShape, setSelectedShape] = useState<ShapeType>("rectangle");
  const [isShapesOpen, setIsShapesOpen] = useState(false);
  const [historyControls, setHistoryControls] = useState<HistoryControls>({
    canUndo: false,
    canRedo: false,
    isExporting: false,
    undo: () => {},
    redo: () => {},
    exportPng: () => {},
  });

  const chooseTool = (tool: WhiteboardTool) => {
    setActiveTool(tool);
    setIsShapesOpen(false);
  };

  const chooseShape = (shape: ShapeType) => {
    setSelectedShape(shape);
    setActiveTool("shape");
    setIsShapesOpen(false);
  };

  return (
    <>
      <div className="board-toolbar">
        <button
          type="button"
          className={`board-tool-button ${
            activeTool === "select" ? "active" : ""
          }`}
          title="Select and move objects"
          aria-pressed={activeTool === "select"}
          onClick={() => chooseTool("select")}
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
          onClick={() => chooseTool("draw")}
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
          onClick={() => chooseTool("erase")}
        >
          <span>⌫</span>
          <span className="tool-label">Eraser</span>
        </button>

        <button
          type="button"
          className={`board-tool-button ${
            activeTool === "note" ? "active" : ""
          }`}
          title="Add a sticky note"
          aria-pressed={activeTool === "note"}
          onClick={() => chooseTool("note")}
        >
          <span>▤</span>
          <span className="tool-label">Notes</span>
        </button>

        <div className="board-shapes-container">
          <button
            type="button"
            className={`board-tool-button ${
              activeTool === "shape" ? "active" : ""
            }`}
            title="Choose a shape"
            aria-expanded={isShapesOpen}
            aria-haspopup="true"
            onClick={() => {
              setIsShapesOpen((open) => !open);
            }}
          >
            <span>◇</span>
            <span className="tool-label">Shapes</span>
          </button>

          {isShapesOpen && (
            <div className="board-shapes-panel">
              <div className="board-shapes-heading">Choose a shape</div>

              <div className="board-shapes-grid">
                {SHAPES.map((shape) => (
                  <button
                    key={shape.type}
                    type="button"
                    className={`board-shape-option ${
                      selectedShape === shape.type && activeTool === "shape"
                        ? "selected"
                        : ""
                    }`}
                    title={shape.label}
                    aria-label={shape.label}
                    aria-pressed={
                      selectedShape === shape.type && activeTool === "shape"
                    }
                    onClick={() => chooseShape(shape.type)}
                  >
                    <span className="board-shape-icon">{shape.icon}</span>
                    <span>{shape.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          className={`board-tool-button ${
            activeTool === "text" ? "active" : ""
          }`}
          title="Add standalone text"
          aria-pressed={activeTool === "text"}
          onClick={() => chooseTool("text")}
        >
          <span>T</span>
          <span className="tool-label">Text</span>
        </button>
        <div className="board-toolbar-divider" />

        <button
          type="button"
          className="board-tool-button"
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          disabled={!historyControls.canUndo}
          onClick={historyControls.undo}
        >
          <span>↶</span>
          <span className="tool-label">Undo</span>
        </button>

        <button
          type="button"
          className="board-tool-button"
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
          disabled={!historyControls.canRedo}
          onClick={historyControls.redo}
        >
          <span>↷</span>
          <span className="tool-label">Redo</span>
        </button>
        <button
          type="button"
          className="board-tool-button"
          title="Export whiteboard as PNG"
          aria-label="Export whiteboard as PNG"
          disabled={historyControls.isExporting}
          onClick={historyControls.exportPng}
        >
          <span>↓</span>
          <span className="tool-label">
            {historyControls.isExporting ? "Exporting..." : "Export PNG"}
          </span>
        </button>
      </div>

      <WhiteboardCanvas
        roomId={roomId}
        activeTool={activeTool}
        selectedShape={selectedShape}
        onHistoryControlsChange={setHistoryControls}
      />
    </>
  );
}
