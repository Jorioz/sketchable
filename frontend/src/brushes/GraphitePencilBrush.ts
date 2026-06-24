import { BaseBrush, FabricImage, Point, Canvas as FabricCanvas } from "fabric";
import type { TBrushEventData } from "fabric";

/**
 * GraphitePencilBrush — mimics iOS PencilKit's `.pencil` (graphite) ink.
 *
 * The defining trait of the iOS pencil is a stippled graphite *grain* that
 * accumulates where strokes overlap — not a wobbly centerline. A vector stroke
 * (what Fabric's PencilBrush commits) cannot carry that grain, so this brush is
 * stamp-based: along a smooth interpolated centerline it scatters many tiny
 * semi-transparent specks. On mouse-up the whole stroke is rasterized into a
 * {@link FabricImage} so the texture survives as a real canvas object (and works
 * with the existing undo/redo, which simply adds/removes objects).
 *
 * Dynamics roughly match the iOS feel for pointer input without true pressure:
 * the faster you move, the lighter and finer the mark (as if pressing softer).
 */

/**
 * Grain specks per CSS px² of a stamp. Constant areal density means the
 * texture looks the same whether the nib is thin or thick. Tuned so the
 * default nib matches the previous hand-picked look.
 */
const GRAIN_DENSITY = 0.8;

/**
 * Nib radius (CSS px) at and below which the grain stays at its base speck
 * size. Above it the grain coarsens proportionally so the texture scales with
 * the stroke instead of staying a fixed fine stipple. Capped by GRAIN_MAX_SCALE.
 */
const GRAIN_REF_RADIUS = 6;
const GRAIN_MAX_SCALE = 3;

interface Speck {
    x: number;
    y: number;
    r: number;
    a: number;
}

interface RGB {
    r: number;
    g: number;
    b: number;
    a: number;
}

function parseColor(input: string): RGB {
    const rgbMatch = input.match(
        /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i,
    );
    if (rgbMatch) {
        return {
            r: Math.round(Number(rgbMatch[1])),
            g: Math.round(Number(rgbMatch[2])),
            b: Math.round(Number(rgbMatch[3])),
            a: rgbMatch[4] !== undefined ? Number(rgbMatch[4]) : 1,
        };
    }
    let hex = input.trim().replace("#", "");
    if (hex.length === 3) {
        hex = hex
            .split("")
            .map((c) => c + c)
            .join("");
    }
    const int = parseInt(hex || "000000", 16);
    return {
        r: (int >> 16) & 255,
        g: (int >> 8) & 255,
        b: int & 255,
        a: 1,
    };
}

export class GraphitePencilBrush extends BaseBrush {
    /** Specks accumulated over the whole stroke, in canvas (CSS) coordinates. */
    private _specks: Speck[] = [];
    private _lastPoint: Point | null = null;
    private _lastTime = 0;
    /** Exponentially-smoothed speed in px/ms, for stable velocity dynamics. */
    private _speed = 0;
    private _drawing = false;

    constructor(canvas: FabricCanvas) {
        super(canvas);
    }

    // --- pointer lifecycle -------------------------------------------------

    onMouseDown(pointer: Point, { e }: TBrushEventData): void {
        if (!this.canvas._isMainEvent(e)) return;
        this._reset();
        this._drawing = true;
        this._lastPoint = pointer;
        this._lastTime = performance.now();
        this._speed = 0;
        // Stamp on touch-down so a tap leaves a mark (a dot).
        const start = this._stampAt(pointer, 1);
        this._paintLive(start);
    }

    onMouseMove(pointer: Point, { e }: TBrushEventData): void {
        if (!this._drawing) return;
        if (!this.canvas._isMainEvent(e)) return;

        const now = performance.now();
        const prev = this._lastPoint!;
        const dx = pointer.x - prev.x;
        const dy = pointer.y - prev.y;
        const dist = Math.hypot(dx, dy);
        if (dist === 0) return;

        const dt = Math.max(1, now - this._lastTime);
        // Smooth the speed so the mark doesn't flicker between samples.
        this._speed = this._speed * 0.6 + (dist / dt) * 0.4;

        // Map speed -> lightness/fineness. Slow, deliberate strokes are rich and
        // a touch wider; fast strokes thin out and lighten, like easing pressure.
        const speedFactor = clamp(1 - this._speed * 0.45, 0.45, 1);

        // Walk the segment and stamp at a fixed spacing for an even, dense grain.
        const radius = this._radius();
        const spacing = Math.max(0.5, radius * 0.4);
        const steps = Math.max(1, Math.floor(dist / spacing));
        const fresh: Speck[] = [];
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const p = new Point(prev.x + dx * t, prev.y + dy * t);
            fresh.push(...this._stampAt(p, speedFactor));
        }
        this._paintLive(fresh);

        this._lastPoint = pointer;
        this._lastTime = now;
    }

    onMouseUp(): boolean {
        if (!this._drawing) return false;
        this._drawing = false;
        this._commit();
        return false;
    }

    // BaseBrush requires this; the stroke is painted incrementally in the
    // pointer handlers, so there is nothing to re-render on demand.
    _render(): void {}

    // --- stamping ----------------------------------------------------------

    /** Effective nib radius in CSS px, derived from the brush width. */
    private _radius(): number {
        return Math.max(0.75, this.width / 2);
    }

    /**
     * Scatter a cluster of grain specks around a point and append them to the
     * stroke buffer. Returns the freshly created specks so the caller can also
     * paint them to the live preview.
     */
    private _stampAt(p: Point, speedFactor: number): Speck[] {
        const radius = this._radius() * (0.85 + 0.15 * speedFactor);
        const { a: strength } = parseColor(this.color);
        // Coarsen the grain on bigger nibs so the texture is relative to the stroke
        // size rather than a fixed fine stipple. Stays at scale 1 up to the
        // reference radius, then grows with the nib (capped).
        const grainScale = clamp(radius / GRAIN_REF_RADIUS, 1, GRAIN_MAX_SCALE);
        // Keep a constant areal *ink density* so thin and thick strokes read at the
        // same darkness. Speck count scales with the stamp's area (radius²), but is
        // divided back down by grainScale² because each speck now covers grainScale²
        // more area — otherwise coarser grain would over-darken wide nibs.
        const count = clamp(
            Math.round(
                (GRAIN_DENSITY * Math.PI * radius * radius) /
                    (grainScale * grainScale),
            ),
            5,
            300,
        );
        const out: Speck[] = [];
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            // sqrt() keeps the scatter uniform across the disk area.
            const rr = radius * Math.sqrt(Math.random());
            // Softer toward the rim so stroke edges feather like real graphite.
            const edge = 1 - Math.pow(rr / radius, 2) * 0.55;
            const a =
                strength * (0.06 + Math.random() * 0.16) * edge * speedFactor;
            if (a <= 0.002) continue;
            out.push({
                x: p.x + Math.cos(angle) * rr,
                y: p.y + Math.sin(angle) * rr,
                r: (0.4 + Math.random() * 0.7) * grainScale,
                a,
            });
        }
        this._specks.push(...out);
        return out;
    }

    // --- rendering ---------------------------------------------------------

    /** Paint a batch of specks onto the live top-canvas preview. */
    private _paintLive(specks: Speck[]): void {
        if (specks.length === 0) return;
        const ctx = this.canvas.contextTop;
        const { r, g, b } = parseColor(this.color);
        this._saveAndTransform(ctx);
        for (const s of specks) {
            ctx.fillStyle = `rgba(${r},${g},${b},${s.a})`;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    /**
     * Rasterize the accumulated specks into a FabricImage and add it to the
     * canvas, then clear the live preview. Mirrors PencilBrush's contract by
     * firing `path:created` so the app's undo/redo bookkeeping stays in sync.
     */
    private _commit(): void {
        const specks = this._specks;
        this.canvas.clearContext(this.canvas.contextTop);
        if (specks.length === 0) {
            this.canvas.requestRenderAll();
            return;
        }

        // Bounding box of the stroke (CSS px), padded for speck radius.
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const s of specks) {
            minX = Math.min(minX, s.x - s.r);
            minY = Math.min(minY, s.y - s.r);
            maxX = Math.max(maxX, s.x + s.r);
            maxY = Math.max(maxY, s.y + s.r);
        }
        const pad = 1;
        minX = Math.floor(minX - pad);
        minY = Math.floor(minY - pad);
        const w = Math.max(1, Math.ceil(maxX + pad - minX));
        const h = Math.max(1, Math.ceil(maxY + pad - minY));

        const dpr = this.canvas.getRetinaScaling();
        const off = document.createElement("canvas");
        off.width = Math.max(1, Math.round(w * dpr));
        off.height = Math.max(1, Math.round(h * dpr));
        const octx = off.getContext("2d");
        if (!octx) return;
        octx.scale(dpr, dpr);
        octx.translate(-minX, -minY);

        const { r, g, b } = parseColor(this.color);
        for (const s of specks) {
            octx.fillStyle = `rgba(${r},${g},${b},${s.a})`;
            octx.beginPath();
            octx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            octx.fill();
        }

        const img = new FabricImage(off, {
            left: minX,
            top: minY,
            originX: "left",
            originY: "top",
            // The element is device-resolution; scale it back down to CSS px.
            scaleX: 1 / dpr,
            scaleY: 1 / dpr,
            selectable: false,
            evented: false,
        });

        this.canvas.add(img);
        this.canvas.requestRenderAll();
        img.setCoords();
        // The app listens for `path:created` to drive undo state.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.canvas.fire("path:created", { path: img as any });
    }

    private _reset(): void {
        this._specks = [];
        this._lastPoint = null;
        this._speed = 0;
    }
}

function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}
