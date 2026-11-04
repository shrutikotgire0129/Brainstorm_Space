"use client";

import { useEffect, useRef, useState } from "react";
import { Canvas, Point, PencilBrush, FabricObject } from "fabric";
import type { WhiteboardTool } from "./board-workspace";

type WhiteboardCanvasProps = {
  roomId: string;
  activeTool: WhiteboardTool;
};

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

    const eraseTarget = (target: unknown) => {
      if (!target || typeof target !== "object") return;

      const fabricTarget = target as FabricObject;

      // Only remove freehand drawing paths.
      if (fabricTarget.type === "path") {
        canvas.remove(fabricTarget);
        canvas.requestRenderAll();
      }
    };

    const handleMouseDown = (event: {
      e: MouseEvent | TouchEvent;
      target?: unknown;
    }) => {
      if (canvas.isDrawingMode) return;

      // Eraser removes the stroke under the pointer.
      if (activeToolRef.current === "erase") {
        eraseTarget(event.target);
        return;
      }

      if (event.target) return;

      const pointerEvent = event.e as MouseEvent;

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
      isPanning = false;

      const tool = activeToolRef.current;

      canvas.setCursor(tool === "select" ? "grab" : "crosshair");

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
    };

    canvas.on("mouse:down", handleMouseDown);
    canvas.on("mouse:move", handleMouseMove);
    canvas.on("mouse:up", handleMouseUp);
    canvas.on("mouse:wheel", handleMouseWheel);

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

      canvas.off("mouse:down", handleMouseDown);
      canvas.off("mouse:move", handleMouseMove);
      canvas.off("mouse:up", handleMouseUp);
      canvas.off("mouse:wheel", handleMouseWheel);

      canvasRef.current = null;

      void canvas.dispose();
    };
  }, []);

  // Synchronize the selected toolbar tool with Fabric.js.
  useEffect(() => {
    activeToolRef.current = activeTool;

    const canvas = canvasRef.current;

    if (!canvas) return;

    const drawingEnabled = activeTool === "draw";

    canvas.isDrawingMode = drawingEnabled;
    canvas.selection = false;

    canvas.defaultCursor = activeTool === "select" ? "grab" : "crosshair";

    canvas.hoverCursor = activeTool === "select" ? "default" : "crosshair";

    canvas.setCursor(activeTool === "select" ? "grab" : "crosshair");

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
  };

  const resetZoom = () => {
    const canvas = canvasRef.current;

    if (!canvas) return;

    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

    setZoom(1);
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
