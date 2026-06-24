import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useDrawing } from '../context/DrawingContext'

const CHECKER = `repeating-conic-gradient(#d1d5db 0% 25%, #ffffff 0% 50%)`

// Half the thumb width (w-7 = 28px) — the thumb centre travels between
// `THUMB_R` and `width - THUMB_R` so it never overflows the track.
const THUMB_R = 14

/**
 * Opacity slider — checkerboard track tinted by the current color, with a
 * draggable thumb and a live percentage. Used inside the color dialog and,
 * on iOS (where the native color picker has no usable alpha), inline in the
 * tool panel.
 *
 * Driven by pointer events rather than a hidden `<input type="range">`: an
 * invisible range input is tappable but won't start a drag from the track on
 * iOS Safari, so we map pointer x → value ourselves and use pointer capture
 * to keep the drag alive while the finger moves.
 */
export default function OpacitySlider({ showLabel = true }: { showLabel?: boolean }) {
  const { color, opacity, setOpacity } = useDrawing()
  const trackRef = useRef<HTMLDivElement>(null)

  const opacityPct = Math.round(opacity * 100)
  const thumbLeft = `calc(${opacity} * (100% - ${THUMB_R * 2}px))`

  function setFromClientX(clientX: number) {
    const el = trackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const usable = rect.width - THUMB_R * 2
    if (usable <= 0) return
    const ratio = (clientX - rect.left - THUMB_R) / usable
    setOpacity(Math.min(1, Math.max(0, ratio)))
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    setFromClientX(e.clientX)
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    // Only react while we're actually dragging (pointer captured on down).
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    setFromClientX(e.clientX)
  }

  return (
    <div>
      {showLabel && (
        <p className="text-[13px] font-medium text-foreground mb-2">Opacity</p>
      )}
      <div className="flex items-center gap-3">
        <div
          ref={trackRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          className="relative flex-1 h-9 flex items-center touch-none select-none cursor-pointer"
        >
          {/* Track — checkerboard + color gradient */}
          <div
            className="absolute inset-x-0 rounded-full overflow-hidden pointer-events-none"
            style={{ height: 22, top: '50%', transform: 'translateY(-50%)' }}
          >
            <div className="absolute inset-0" style={{ backgroundImage: CHECKER, backgroundSize: '11px 11px' }} />
            <div className="absolute inset-0" style={{ background: `linear-gradient(to right, transparent, ${color})` }} />
          </div>
          {/* Thumb */}
          <div
            className="absolute w-7 h-7 rounded-full bg-white pointer-events-none"
            style={{
              left: thumbLeft,
              top: '50%',
              transform: 'translateY(-50%)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.28), 0 0 0 1.5px rgba(0,0,0,0.08)',
            }}
          />
        </div>
        <span className="text-sm font-medium text-foreground w-11 text-right tabular-nums">
          {opacityPct}%
        </span>
      </div>
    </div>
  )
}
