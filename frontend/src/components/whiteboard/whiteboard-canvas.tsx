"use client";

import { useEffect, useRef, useState } from "react";
import {
  Canvas,
  Point,
  PencilBrush,
  FabricObject,
  IText,
  Textbox,
} from "fabric";
import type { WhiteboardTool } from "./board-workspace";

type WhiteboardCanvasProps = {
  roomId: string;
  activeTool: WhiteboardTool;
};

const NOTE_COLORS = ["#FFF2A8", "#FFD6D6", "#D9F2E6", "#DCE8FF", "#EADCF8"];
const ERASER_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Cpath d='M7 18L16 5L25 11L16 24L7 18Z' fill='%23F2B8C6' stroke='%23252525' stroke-width='1.5'/%3E%3Cpath d='M7 18L16 24L12 28L3 22L7 18Z' fill='%23FFFFFF' stroke='%23252525' stroke-width='1.5'/%3E%3Cpath d='M12 28H25' stroke='%23252525' stroke-width='1.5'/%3E%3C/svg%3E\") 5 22, auto";

function persistBoard(canvas: Canvas, roomId: string) {
  try {
    const boardState = {
      version: 1,
      canvas: canvas.toJSON(),
      viewportTransform: canvas.viewportTransform
        ? [...canvas.viewportTransform]
        : [1, 0, 0, 1, 0, 0],
      zoom: canvas.getZoom(),
    };

    localStorage.setItem(
      `brainstorm-space-board:${roomId}`,
      JSON.stringify(boardState),
    );
  } catch (error) {
    console.error("Failed to save whiteboard:", error);
  }
}

export default function WhiteboardCanvas({
  roomId,
  activeTool,
}: WhiteboardCanvasProps) {
  const canvasElementRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<Canvas | null>(null);
  const activeToolRef = useRef<WhiteboardTool>(activeTool);

  const [zoom, setZoom] = useState(1);
  const [brushColor, setBrushColor] = useState("#252525");
  const [brushSize, setBrushSize] = useState(3);
  const [noteColor, setNoteColor] = useState(NOTE_COLORS[0]);

  const noteColorRef = useRef(noteColor);

  useEffect(() => {
    noteColorRef.current = noteColor;
  }, [noteColor]);

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
    let lastPointerX = 0;
    let lastPointerY = 0;

    let isRestoring = false;
    let saveTimeout: ReturnType<typeof setTimeout> | null = null;

    const saveBoard = () => {
      if (isRestoring) return;

      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }

      saveTimeout = setTimeout(() => {
        persistBoard(canvas, roomId);
      }, 300);
    };

    // Restore the saved board for this room.
    const restoreBoard = async () => {
      const storageKey = `brainstorm-space-board:${roomId}`;

      try {
        const saved = localStorage.getItem(storageKey);

        if (!saved) return;

        const savedState = JSON.parse(saved) as {
          version?: number;
          canvas?: Record<string, unknown>;
          viewportTransform?: unknown;
          zoom?: unknown;
        };

        if (!savedState.canvas || typeof savedState.canvas !== "object") {
          return;
        }

        isRestoring = true;

        await canvas.loadFromJSON(savedState.canvas);

        const transform = savedState.viewportTransform;

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
          typeof savedState.zoom === "number" &&
          Number.isFinite(savedState.zoom)
        ) {
          setZoom(savedState.zoom);
        }

        canvas.requestRenderAll();
      } catch (error) {
        console.error("Failed to restore whiteboard:", error);
      } finally {
        isRestoring = false;
      }
    };

    void restoreBoard();

    const eraseTarget = (target: unknown) => {
      if (!target || typeof target !== "object") return;

      const fabricTarget = target as FabricObject;

      // The eraser only removes freehand drawing paths.
      if (fabricTarget.type === "path") {
        canvas.remove(fabricTarget);
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
      if (isPanning) {
        saveBoard();
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
      if (event.key !== "Delete" && event.key !== "Backspace") return;

      const target = event.target;

      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      const activeObject = canvas.getActiveObject();

      if (!activeObject) return;

      if (activeObject.type !== "textbox" && activeObject.type !== "i-text") {
        return;
      }

      canvas.remove(activeObject);
      canvas.discardActiveObject();
      canvas.requestRenderAll();
    };

    canvas.on("mouse:down", handleMouseDown);
    canvas.on("mouse:move", handleMouseMove);
    canvas.on("mouse:up", handleMouseUp);
    canvas.on("mouse:wheel", handleMouseWheel);
    // Automatically save changes to the board.
    canvas.on("object:added", saveBoard);
    canvas.on("object:modified", saveBoard);
    canvas.on("object:removed", saveBoard);
    canvas.on("path:created", saveBoard);
    canvas.on("text:changed", saveBoard);

    window.addEventListener("keydown", handleKeyDown);

    const resizeObserver = new ResizeObserver(() => {
      canvas.setDimensions({
        width: wrapper.clientWidth,
        height: wrapper.clientHeight,
      });

      canvas.requestRenderAll();
    });

    resizeObserver.observe(wrapper);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("keydown", handleKeyDown);

      canvas.off("mouse:down", handleMouseDown);
      canvas.off("mouse:move", handleMouseMove);
      canvas.off("mouse:up", handleMouseUp);
      canvas.off("mouse:wheel", handleMouseWheel);

      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }

      canvas.off("object:added", saveBoard);
      canvas.off("object:modified", saveBoard);
      canvas.off("object:removed", saveBoard);
      canvas.off("path:created", saveBoard);
      canvas.off("text:changed", saveBoard);

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
    persistBoard(canvas, roomId);
  };

  const resetZoom = () => {
    const canvas = canvasRef.current;

    if (!canvas) return;

    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

    setZoom(1);
    persistBoard(canvas, roomId);
  };

  return (
    <section className="whiteboard-workspace">
      <div className="whiteboard-canvas-wrapper">
        <canvas ref={canvasElementRef} />
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
