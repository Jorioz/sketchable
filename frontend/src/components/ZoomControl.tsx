import { IoAdd, IoRemove, IoHandRightOutline } from "react-icons/io5";
import { useDrawing, MIN_ZOOM, MAX_ZOOM } from "../context/DrawingContext";
import { cn } from "@/lib/utils";

const ZOOM_STEP = 0.25;

/**
 * Floating zoom chip overlaid on the canvas: −/+ step the zoom in 25%
 * increments within 100–300%, tapping the percentage resets to 100%, and a
 * hand toggle (visible only while zoomed in) switches drag-to-pan on.
 */
export default function ZoomControl() {
    const { zoom, setZoom, panMode, setPanMode } = useDrawing();
    const pct = Math.round(zoom * 100);

    return (
        <div className="absolute top-3 right-3 z-50 flex items-center gap-0.5 rounded-full bg-white/90 backdrop-blur px-1.5 py-1 shadow-[0_2px_10px_rgba(0,0,0,0.12)]">
            <button
                type="button"
                aria-label="Zoom out"
                disabled={zoom <= MIN_ZOOM}
                onClick={() => setZoom(zoom - ZOOM_STEP)}
                className="flex size-7 items-center justify-center rounded-full text-neutral-700 disabled:opacity-30 active:bg-neutral-200"
            >
                <IoRemove className="size-4" />
            </button>
            <button
                type="button"
                aria-label="Reset zoom to 100%"
                onClick={() => setZoom(MIN_ZOOM)}
                className="min-w-11 text-center text-[12px] font-semibold tabular-nums text-neutral-700"
            >
                {pct}%
            </button>
            <button
                type="button"
                aria-label="Zoom in"
                disabled={zoom >= MAX_ZOOM}
                onClick={() => setZoom(zoom + ZOOM_STEP)}
                className="flex size-7 items-center justify-center rounded-full text-neutral-700 disabled:opacity-30 active:bg-neutral-200"
            >
                <IoAdd className="size-4" />
            </button>
            {zoom > MIN_ZOOM && (
                <button
                    type="button"
                    aria-label={panMode ? "Switch to drawing" : "Switch to panning"}
                    aria-pressed={panMode}
                    onClick={() => setPanMode(!panMode)}
                    className={cn(
                        "ml-0.5 flex size-7 items-center justify-center rounded-full active:bg-neutral-200",
                        panMode
                            ? "bg-neutral-800 text-white active:bg-neutral-700"
                            : "text-neutral-700",
                    )}
                >
                    <IoHandRightOutline className="size-4" />
                </button>
            )}
        </div>
    );
}
