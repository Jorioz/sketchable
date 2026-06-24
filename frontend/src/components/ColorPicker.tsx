import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { useDrawing } from "../context/DrawingContext";
import { isIOS } from "@/lib/utils";
import ColorPickerPopup from "./ColorPickerPopup";

// Rainbow ring with the selected color in the center — shared by both the
// dialog trigger (other platforms) and the direct native picker (iOS).
const SWATCH_CLASS =
    "relative w-11 h-11 rounded-full shrink-0 cursor-pointer shadow-[0_1px_4px_rgba(0,0,0,0.2)] bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]";

function SelectedDot({ color }: { color: string }) {
    return (
        <span
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full border-3 border-white"
            style={{ background: color }}
        />
    );
}

export default function ColorPicker() {
    const { color, pickColor } = useDrawing();

    // On iOS the OS owns color selection — its native picker is a full wheel
    // with its own UI, so our dialog + swatch grid is redundant. Tap the ring
    // to hand control straight to the system picker, like the popup's swatch.
    if (isIOS()) {
        return (
            <label className={SWATCH_CLASS} aria-label="Pick a color">
                <SelectedDot color={color} />
                <input
                    type="color"
                    value={color}
                    onChange={(e) => pickColor(e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
            </label>
        );
    }

    return (
        <Dialog>
            <DialogTrigger
                render={
                    <button className={SWATCH_CLASS}>
                        <SelectedDot color={color} />
                    </button>
                }
            />
            <DialogContent className="top-auto bottom-0 left-1/2 -translate-x-1/2 translate-y-0 w-full max-w-md rounded-3xl rounded-b-none p-5 pb-8 pt-3 max-h-[90dvh] overflow-y-auto">
                {/* iOS-style sheet grabber */}
                <div className="mx-auto mb-1 h-1.5 w-10 rounded-full bg-foreground/15" />
                <DialogHeader>
                    <DialogTitle className="text-center">Colors</DialogTitle>
                </DialogHeader>
                <ColorPickerPopup />
            </DialogContent>
        </Dialog>
    );
}
