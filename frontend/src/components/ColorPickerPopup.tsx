import { useDrawing } from "../context/DrawingContext";
import OpacitySlider from "./OpacitySlider";

// HSL → 6-digit hex
function hslToHex(h: number, s: number, l: number): string {
    s /= 100;
    l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
        const k = (n + h / 30) % 12;
        const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
        return Math.round(255 * c)
            .toString(16)
            .padStart(2, "0");
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

const HUES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

// 12 cols × 10 rows
const COLOR_GRID: string[][] = [
    // Row 0 — grayscale, white → black
    Array.from({ length: 12 }, (_, i) =>
        hslToHex(0, 0, Math.round(100 - (i / 11) * 100)),
    ),
    // Rows 1–9 — hues × lightness
    ...(
        [
            [65, 20],
            [70, 30],
            [75, 40],
            [80, 50],
            [80, 60],
            [70, 70],
            [60, 78],
            [50, 85],
            [40, 92],
        ] as [number, number][]
    ).map(([s, l]) => HUES.map((h) => hslToHex(h, s, l))),
];

const CHECKER = `repeating-conic-gradient(#d1d5db 0% 25%, #ffffff 0% 50%)`;

export default function ColorPickerPopup() {
    const { color, pickColor, opacity } = useDrawing();

    return (
        <div className="flex flex-col gap-6 ">
            {/* 12 × 10 color grid — edge-to-edge like the iOS "Grid" tab */}
            <div className="grid grid-cols-12 rounded-2xl overflow-hidden">
                {COLOR_GRID.flat().map((c, i) => {
                    const isSelected = color.toLowerCase() === c.toLowerCase();
                    return (
                        <button
                            key={i}
                            onClick={() => pickColor(c)}
                            className="aspect-square relative transition-transform active:scale-90"
                            style={{
                                background: c,
                                // iOS selection: a white ring hugging the swatch edge.
                                boxShadow: isSelected
                                    ? "inset 0 0 0 3px #fff, inset 0 0 0 4.5px rgba(0,0,0,0.18)"
                                    : undefined,
                                zIndex: isSelected ? 1 : undefined,
                            }}
                        />
                    );
                })}
            </div>

            {/* Opacity */}
            <OpacitySlider />

            {/* Current color — tap the swatch to open the system color wheel */}
            <div className="flex items-center gap-4">
                <label
                    className="relative w-16 h-16 rounded-full overflow-hidden shrink-0 cursor-pointer"
                    style={{
                        boxShadow: "0 0 0 4px #fff, 0 0 0 5px rgba(0,0,0,0.12)",
                    }}
                >
                    <div
                        className="absolute inset-0"
                        style={{
                            backgroundImage: CHECKER,
                            backgroundSize: "10px 10px",
                        }}
                    />
                    <div
                        className="absolute inset-0"
                        style={{ background: color, opacity }}
                    />
                    <input
                        type="color"
                        value={color}
                        onChange={(e) => pickColor(e.target.value)}
                        aria-label="Pick a custom color"
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                </label>
                <div className="flex flex-col gap-0.5">
                    <span className="text-[11px] text-muted-foreground">
                        Current color
                    </span>
                    <span className="text-sm font-mono font-medium text-foreground uppercase">
                        {color}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                        Tap the swatch for a custom color
                    </span>
                </div>
            </div>
        </div>
    );
}
