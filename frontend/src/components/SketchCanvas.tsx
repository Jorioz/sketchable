import { useEffect, useRef, useState } from "react";
import { Canvas, PencilBrush } from "fabric";
import type { FabricObject, BaseBrush } from "fabric";
import { GraphitePencilBrush } from "../brushes/GraphitePencilBrush";
import { useLayers } from "../hooks/useLayers";
import { useDrawing } from "../context/DrawingContext";
import type { Tool } from "../context/DrawingContext";

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
        setCanUndo,
        setCanRedo,
        registerHandlers,
    } = useDrawing();

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
                    // Source canvas may be retina-scaled (larger); drawImage with
                    // explicit dest size rescales it back to CSS pixels.
                    ctx.drawImage(fc.getElement(), 0, 0, width, height);
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
            className="mx-auto relative bg-white shadow-[0_2px_16px_rgba(0,0,0,0.10)] rounded-4xl overflow-hidden"
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
        </div>
    );
}
