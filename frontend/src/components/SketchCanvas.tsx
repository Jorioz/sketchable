import { useEffect, useRef, useState } from "react";
import { Canvas, PencilBrush } from "fabric";
import type { FabricObject, BaseBrush } from "fabric";
import { GraphitePencilBrush } from "../brushes/GraphitePencilBrush";
import { useLayers } from "../hooks/useLayers";
import { useDrawing, MIN_ZOOM, MAX_ZOOM } from "../context/DrawingContext";
import type { Tool } from "../context/DrawingContext";
import ZoomControl from "./ZoomControl";

type SketchCanvasProps = {
    onContentChange?: (hasContent: boolean) => void;
};

function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

function applyBrush(
    fc: Canvas,
    tool: Tool,
    color: string,
    size: number,
    opacity: number,
): void {
    let brush: BaseBrush;
    if (tool === "eraser") {
        brush = new PencilBrush(fc);
        brush.width = size * 3;
        brush.color = "#ffffff";
    } else if (tool === "marker") {
        // Solid, opaque — the primary drawing tool
        brush = new PencilBrush(fc);
        brush.width = size;
        brush.color = hexToRgba(color, opacity);
    } else if (tool === "pencil") {
        // Graphite grain — stamp-based texture that accumulates on overlap,
        // rasterized to an image on commit. Mimics iOS PencilKit's pencil.
        brush = new GraphitePencilBrush(fc);
        // Match the marker's width so the size slider reads the same across tools.
        brush.width = size;
        brush.color = hexToRgba(color, opacity);
    } else {
        // Highlighter — semi-transparent, wide, flat strokes. Broader than the
        // pen but kept sane: ~6–120px across the slider rather than 12–240px.
        brush = new PencilBrush(fc);
        brush.width = size * 3;
        brush.color = hexToRgba(color, opacity * 0.32);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (brush as any).strokeLineCap = "square";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (brush as any).strokeLineJoin = "miter";
    }
    fc.freeDrawingBrush = brush;
    fc.isDrawingMode = true;
}

export default function SketchCanvas({ onContentChange }: SketchCanvasProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const fabricCanvases = useRef<Record<number, Canvas>>({});
    const redoStacksRef = useRef<Record<number, FabricObject[]>>({});
    const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

    const { layers, activeLayerId } = useLayers();
    const {
        tool,
        color,
        opacity,
        brushSize,
        zoom,
        setZoom,
        panMode,
        setCanUndo,
        setCanRedo,
        registerHandlers,
    } = useDrawing();

    // Zoom/pan viewport, applied identically to every layer canvas. Pan is in
    // screen pixels, clamped so the (zoomed) canvas always covers the viewport.
    const zoomRef = useRef(zoom);
    const panRef = useRef({ x: 0, y: 0 });
    const panPointerRef = useRef<{ id: number; x: number; y: number } | null>(
        null,
    );

    const clampPan = (v: number, z: number, size: number) =>
        Math.min(0, Math.max(size * (1 - z), v));

    const applyViewport = () => {
        const z = zoomRef.current;
        const { x, y } = panRef.current;
        Object.values(fabricCanvases.current).forEach((fc) => {
            fc.setViewportTransform([z, 0, 0, z, x, y]);
            fc.requestRenderAll();
        });
    };

    // Zoom to `next`, keeping the canvas point under (cx, cy) — wrapper-local
    // screen px — fixed. Used by wheel zoom and pinch; updates refs first so
    // the zoom effect sees zoom === zoomRef and only re-clamps. Reads only
    // refs and the stable setZoom, so stale closures are harmless.
    const applyZoomAt = (next: number, cx: number, cy: number) => {
        // Wrapper width == canvas size (square); read from the DOM so stale
        // closures (the [] wheel effect) still see the current size.
        const size = wrapperRef.current?.clientWidth ?? 0;
        if (!size) return;
        const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
        const prev = zoomRef.current;
        panRef.current = {
            x: clampPan(cx - (cx - panRef.current.x) * (z / prev), z, size),
            y: clampPan(cy - (cy - panRef.current.y) * (z / prev), z, size),
        };
        zoomRef.current = z;
        applyViewport();
        setZoom(z);
    };

    // Desktop: zoom with the scroll wheel / trackpad, anchored at the cursor.
    // Attached natively because React root wheel listeners are passive and
    // preventDefault (needed to stop page scroll) would be ignored.
    const wrapperRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = wrapperRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const rect = el.getBoundingClientRect();
            applyZoomAt(
                zoomRef.current * Math.exp(-e.deltaY * 0.0022),
                e.clientX - rect.left,
                e.clientY - rect.top,
            );
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Touch: two-finger pinch zoom + pan. Events are intercepted in the
    // capture phase (before Fabric's own listeners) once a second finger
    // lands, and stay blocked until every finger lifts so Fabric never
    // finalizes the stroke the first finger may have started — the partial
    // stroke is discarded by clearing the drawing overlay.
    const gesturePointers = useRef(new Map<number, { x: number; y: number }>());
    const gestureActiveRef = useRef(false);

    const onGesturePointerDown = (e: React.PointerEvent) => {
        if (e.pointerType !== "touch") return;
        gesturePointers.current.set(e.pointerId, {
            x: e.clientX,
            y: e.clientY,
        });
        if (gestureActiveRef.current) {
            e.stopPropagation();
            return;
        }
        if (gesturePointers.current.size === 2) {
            gestureActiveRef.current = true;
            e.stopPropagation();
            // Abort the stroke the first finger started: with drawing mode off
            // Fabric won't finalize it into a path, and wiping the overlay
            // context removes its preview.
            const fc = fabricCanvases.current[activeLayerId];
            if (fc) {
                fc.isDrawingMode = false;
                fc.clearContext(fc.contextTop);
                fc.requestRenderAll();
            }
        }
    };

    const onGesturePointerMove = (e: React.PointerEvent) => {
        if (!gestureActiveRef.current) return;
        const pts = gesturePointers.current;
        const self = pts.get(e.pointerId);
        if (!self) return;
        e.stopPropagation();
        const other = [...pts.entries()].find(([id]) => id !== e.pointerId)?.[1];
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (!other || pts.size !== 2 || !wrapperRef.current) return;
        const rect = wrapperRef.current.getBoundingClientRect();
        const prevDist = Math.hypot(self.x - other.x, self.y - other.y);
        const newDist = Math.hypot(e.clientX - other.x, e.clientY - other.y);
        const prevZ = zoomRef.current;
        const z = prevDist > 0 ? prevZ * (newDist / prevDist) : prevZ;
        // Anchor so the canvas point under the previous centroid lands on the
        // new centroid — this makes the same gesture both pinch and pan.
        const prevCx = (self.x + other.x) / 2 - rect.left;
        const prevCy = (self.y + other.y) / 2 - rect.top;
        const newCx = (e.clientX + other.x) / 2 - rect.left;
        const newCy = (e.clientY + other.y) / 2 - rect.top;
        panRef.current = {
            x: panRef.current.x + (newCx - prevCx),
            y: panRef.current.y + (newCy - prevCy),
        };
        applyZoomAt(z, newCx, newCy);
    };

    const onGesturePointerEnd = (e: React.PointerEvent) => {
        if (e.pointerType !== "touch") return;
        if (!gesturePointers.current.delete(e.pointerId)) return;
        if (!gestureActiveRef.current) return;
        e.stopPropagation();
        // Keep blocking until every finger lifts, so Fabric never sees the
        // tail of the gesture as drawing input.
        if (gesturePointers.current.size === 0) {
            gestureActiveRef.current = false;
            const fc = fabricCanvases.current[activeLayerId];
            if (fc) fc.isDrawingMode = true;
        }
    };

    const toolRef = useRef(tool);
    const colorRef = useRef(color);
    const opacityRef = useRef(opacity);
    const sizeRef = useRef(brushSize);
    // Tracked in refs so the (rarely re-registered) export handler always reads
    // the current layers and dimensions instead of a stale closure.
    const layersRef = useRef(layers);
    const canvasSizeRef = useRef(canvasSize);
    useEffect(() => {
        layersRef.current = layers;
    }, [layers]);
    useEffect(() => {
        canvasSizeRef.current = canvasSize;
    }, [canvasSize]);
    useEffect(() => {
        toolRef.current = tool;
    }, [tool]);
    useEffect(() => {
        colorRef.current = color;
    }, [color]);
    useEffect(() => {
        opacityRef.current = opacity;
    }, [opacity]);
    useEffect(() => {
        sizeRef.current = brushSize;
    }, [brushSize]);

    useEffect(() => {
        const el = containerRef.current;
        const host = el?.parentElement?.parentElement;
        if (!el || !host) return;
        const ro = new ResizeObserver((entries) => {
            const { width, height } = entries[0].contentRect;
            const size = Math.floor(Math.min(width, height));
            setCanvasSize({
                width: size,
                height: size,
            });
        });
        ro.observe(host);
        el.addEventListener("touchmove", (e) => e.preventDefault(), {
            passive: false,
        });
        return () => ro.disconnect();
    }, []);

    useEffect(() => {
        const { width, height } = canvasSize;
        if (!width || !height || !containerRef.current) return;

        layers.forEach((layer) => {
            if (fabricCanvases.current[layer.id]) return;

            const el = document.createElement("canvas");
            el.id = `layer-${layer.id}`;
            containerRef.current!.appendChild(el);

            const fc = new Canvas(el, {
                width,
                height,
                isDrawingMode: true,
                enableRetinaScaling: true,
            });

            const wrapper = fc.getElement().parentElement;
            if (wrapper) {
                Object.assign(wrapper.style, {
                    position: "absolute",
                    top: "0",
                    left: "0",
                    width: `${width}px`,
                    height: `${height}px`,
                });
            }

            fc.on("path:created", () => {
                redoStacksRef.current[layer.id] = [];
                setCanUndo(true);
                setCanRedo(false);
            });

            fabricCanvases.current[layer.id] = fc;
            applyBrush(
                fc,
                toolRef.current,
                colorRef.current,
                sizeRef.current,
                opacityRef.current,
            );
        });
    }, [layers, canvasSize, setCanUndo, setCanRedo]);

    useEffect(() => {
        const activeIds = new Set(layers.map((l) => l.id));
        Object.keys(fabricCanvases.current).forEach((id) => {
            const numId = Number(id);
            if (!activeIds.has(numId)) {
                const fc = fabricCanvases.current[numId];
                const wrapper = fc.getElement()?.parentElement;
                fc.dispose();
                wrapper?.remove();
                delete fabricCanvases.current[numId];
            }
        });
    }, [layers]);

    useEffect(() => {
        layers.forEach((layer, index) => {
            const fc = fabricCanvases.current[layer.id];
            if (!fc) return;
            const wrapper = fc.getElement()?.parentElement;
            if (!wrapper) return;
            wrapper.style.zIndex = String(index);
            wrapper.style.opacity = String(layer.visible ? layer.opacity : 0);
            wrapper.style.pointerEvents =
                layer.id === activeLayerId ? "auto" : "none";
        });
    }, [layers, activeLayerId]);

    useEffect(() => {
        const { width, height } = canvasSize;
        if (!width || !height) return;
        Object.values(fabricCanvases.current).forEach((fc) =>
            fc.setDimensions({ width, height }),
        );
    }, [canvasSize]);

    useEffect(() => {
        const fc = fabricCanvases.current[activeLayerId];
        if (fc) applyBrush(fc, tool, color, brushSize, opacity);
    }, [tool, color, opacity, brushSize, activeLayerId]);

    // Re-apply the viewport when zoom changes, keeping the visible center
    // fixed, and whenever the canvas set or its size changes (new layers start
    // at identity; a resize can leave the pan out of bounds).
    useEffect(() => {
        const size = canvasSize.width;
        if (!size) return;
        const prev = zoomRef.current;
        if (zoom !== prev) {
            const c = size / 2;
            panRef.current = {
                x: clampPan(c - (c - panRef.current.x) * (zoom / prev), zoom, size),
                y: clampPan(c - (c - panRef.current.y) * (zoom / prev), zoom, size),
            };
            zoomRef.current = zoom;
        } else {
            panRef.current = {
                x: clampPan(panRef.current.x, zoom, size),
                y: clampPan(panRef.current.y, zoom, size),
            };
        }
        applyViewport();
    }, [zoom, canvasSize, layers]);

    useEffect(() => {
        const fc = fabricCanvases.current[activeLayerId];
        setCanUndo(!!fc && fc.getObjects().length > 0);
        setCanRedo(!!redoStacksRef.current[activeLayerId]?.length);
        onContentChange?.(!!fc && fc.getObjects().length > 0);
    }, [activeLayerId, onContentChange, setCanUndo, setCanRedo]);

    useEffect(() => {
        registerHandlers(
            () => {
                const fc = fabricCanvases.current[activeLayerId];
                if (!fc) return;
                const objs = fc.getObjects();
                if (objs.length === 0) return;
                const last = objs[objs.length - 1];
                fc.remove(last);
                fc.renderAll();
                if (!redoStacksRef.current[activeLayerId])
                    redoStacksRef.current[activeLayerId] = [];
                redoStacksRef.current[activeLayerId].push(last);
                setCanUndo(fc.getObjects().length > 0);
                setCanRedo(true);
                onContentChange?.(fc.getObjects().length > 0);
            },
            () => {
                const fc = fabricCanvases.current[activeLayerId];
                if (!fc) return;
                const stack = redoStacksRef.current[activeLayerId];
                if (!stack?.length) return;
                const obj = stack.pop()!;
                fc.add(obj);
                fc.renderAll();
                setCanUndo(true);
                setCanRedo(stack.length > 0);
                onContentChange?.(true);
            },
            // clear — wipe the active layer and reset its history
            () => {
                const fc = fabricCanvases.current[activeLayerId];
                if (!fc) return;
                fc.remove(...fc.getObjects());
                fc.renderAll();
                redoStacksRef.current[activeLayerId] = [];
                setCanUndo(false);
                setCanRedo(false);
                onContentChange?.(false);
            },
            // exportPNG — flatten every visible layer (in z-order, honoring its
            // opacity) onto a white background and return a PNG data URL.
            () => {
                const { width, height } = canvasSizeRef.current;
                if (!width || !height) return null;
                const out = document.createElement("canvas");
                out.width = width;
                out.height = height;
                const ctx = out.getContext("2d");
                if (!ctx) return null;
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, width, height);
                layersRef.current.forEach((layer) => {
                    const fc = fabricCanvases.current[layer.id];
                    if (!fc || !layer.visible) return;
                    ctx.globalAlpha = layer.opacity;
                    // The element shows the zoomed viewport; render at identity
                    // for the capture so the export is the full, unzoomed canvas.
                    const vpt = [...fc.viewportTransform] as typeof fc.viewportTransform;
                    fc.setViewportTransform([1, 0, 0, 1, 0, 0]);
                    fc.renderAll();
                    // Source canvas may be retina-scaled (larger); drawImage with
                    // explicit dest size rescales it back to CSS pixels.
                    ctx.drawImage(fc.getElement(), 0, 0, width, height);
                    fc.setViewportTransform(vpt);
                    fc.renderAll();
                });
                ctx.globalAlpha = 1;
                return out.toDataURL("image/png");
            },
        );
    }, [activeLayerId, registerHandlers, setCanUndo, setCanRedo]);

    useEffect(() => {
        return () => {
            Object.values(fabricCanvases.current).forEach((fc) => fc.dispose());
        };
    }, []);

    return (
        <div
            ref={wrapperRef}
            className="mx-auto relative bg-white shadow-[0_2px_16px_rgba(0,0,0,0.10)] rounded-4xl overflow-hidden"
            onPointerDownCapture={onGesturePointerDown}
            onPointerMoveCapture={onGesturePointerMove}
            onPointerUpCapture={onGesturePointerEnd}
            onPointerCancelCapture={onGesturePointerEnd}
            style={
                canvasSize.width
                    ? {
                          width: `${canvasSize.width}px`,
                          height: `${canvasSize.height}px`,
                      }
                    : undefined
            }
        >
            <div ref={containerRef} className="absolute inset-0" />
            {panMode && (
                <div
                    className="absolute inset-0 z-40 cursor-grab active:cursor-grabbing touch-none"
                    onPointerDown={(e) => {
                        panPointerRef.current = {
                            id: e.pointerId,
                            x: e.clientX,
                            y: e.clientY,
                        };
                        e.currentTarget.setPointerCapture(e.pointerId);
                    }}
                    onPointerMove={(e) => {
                        const p = panPointerRef.current;
                        if (!p || p.id !== e.pointerId) return;
                        const size = canvasSize.width;
                        panRef.current = {
                            x: clampPan(
                                panRef.current.x + e.clientX - p.x,
                                zoomRef.current,
                                size,
                            ),
                            y: clampPan(
                                panRef.current.y + e.clientY - p.y,
                                zoomRef.current,
                                size,
                            ),
                        };
                        p.x = e.clientX;
                        p.y = e.clientY;
                        applyViewport();
                    }}
                    onPointerUp={() => (panPointerRef.current = null)}
                    onPointerCancel={() => (panPointerRef.current = null)}
                />
            )}
            <ZoomControl />
        </div>
    );
}
