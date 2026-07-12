import { IoAdd, IoRemove, IoMove } from "react-icons/io5";
import { useDrawing, MIN_ZOOM, MAX_ZOOM } from "../context/DrawingContext";
import { cn } from "@/lib/utils";

const ZOOM_STEP = 0.25;

/**
 * Toolbar zoom pill, styled to sit inline with UndoRedo: a move-mode toggle
 * (while on, canvas drags pan and pinches zoom instead of drawing) plus −/+
 * steppers around the current zoom percentage.
 */
export default function ZoomControl() {
    const { zoom, setZoom, moveMode, setMoveMode } = useDrawing();

    return (
        <div className="flex items-center gap-1 rounded-full bg-black/5 p-1">
            <button
                onClick={() => setMoveMode(!moveMode)}
                aria-label={moveMode ? "Stop moving, draw" : "Move and zoom"}
                aria-pressed={moveMode}
                className={cn(
                    "flex items-center justify-center w-8 h-8 rounded-full transition-transform active:scale-90",
                    moveMode && "bg-neutral-800 text-white",
                )}
            >
                <IoMove className="size-[18px]" />
            </button>
            <button
                onClick={() => setZoom(zoom - ZOOM_STEP)}
                disabled={zoom <= MIN_ZOOM}
                aria-label="Zoom out"
                className="flex items-center justify-center w-8 h-8 rounded-full transition-transform active:scale-90 disabled:opacity-30"
            >
                <IoRemove className="size-[18px]" />
            </button>
            <span className="min-w-10 text-center text-[12px] font-semibold tabular-nums text-neutral-700">
                {Math.round(zoom * 100)}%
            </span>
            <button
                onClick={() => setZoom(zoom + ZOOM_STEP)}
                disabled={zoom >= MAX_ZOOM}
                aria-label="Zoom in"
                className="flex items-center justify-center w-8 h-8 rounded-full transition-transform active:scale-90 disabled:opacity-30"
            >
                <IoAdd className="size-[18px]" />
            </button>
        </div>
    );
}
