import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useDrawing } from "../context/DrawingContext";

const MIN_SIZE = 2;
const MAX_SIZE = 40;

export default function BrushSizeSelector() {
    const { brushSize, setBrushSize, tool, color } = useDrawing();
    const trackRef = useRef<HTMLDivElement>(null);

    const pct = (brushSize - MIN_SIZE) / (MAX_SIZE - MIN_SIZE);
    const thumbSize = 12 + pct * 30;

    const thumbColor = tool === "eraser" ? "#9ca3af" : color;

    // Driven by pointer events rather than a hidden `<input type="range">`,
    // which on iOS Safari is tappable but won't start a drag from the track.
    function setFromClientX(clientX: number) {
        const el = trackRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0) return;
        const ratio = Math.min(
            1,
            Math.max(0, (clientX - rect.left) / rect.width),
        );
        setBrushSize(Math.round(MIN_SIZE + ratio * (MAX_SIZE - MIN_SIZE)));
    }

    function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
        e.currentTarget.setPointerCapture(e.pointerId);
        setFromClientX(e.clientX);
    }

    function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
        // Only react while actually dragging (pointer captured on down).
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        setFromClientX(e.clientX);
    }

    return (
        <div
            ref={trackRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            className="relative h-11 flex items-center touch-none select-none cursor-pointer"
        >
            {/* Taper track */}
            <svg
                viewBox="0 0 200 40"
                preserveAspectRatio="none"
                className="absolute inset-x-0 w-full pointer-events-none rounded-md"
                style={{
                    height: 30,
                    top: "50%",
                    transform: "translateY(-50%)",
                }}
            >
                <polygon points="0,19 0,21 200,40 200,0" fill="#e5e7eb" />
            </svg>

            {/* Thumb circle — scales with value */}
            <div
                className="absolute rounded-full pointer-events-none"
                style={{
                    width: thumbSize,
                    height: thumbSize,
                    left: `calc(${pct} * (100% - ${thumbSize / 1.2}px))`,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: thumbColor,
                    border: "3px solid white",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
                }}
            />
        </div>
    );
}
