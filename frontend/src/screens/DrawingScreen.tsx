import { DrawingProvider } from "../context/DrawingContext";
import SketchCanvas from "../components/SketchCanvas";
import UndoRedo from "../components/UndoRedo";
import ClearCanvas from "../components/ClearCanvas";
import SendNote from "../components/SendNote";
import BrushSizeSelector from "../components/BrushSizeSelector";
import ColorPicker from "../components/ColorPicker";
import OpacitySlider from "../components/OpacitySlider";
import ToolSelector from "../components/ToolSelector";
import { isIOS } from "@/lib/utils";
import Layout from "../components/Layout";
import type { NavState } from "../navigation";

export default function DrawingScreen(nav: NavState) {
    return (
        <DrawingProvider>
            <Layout screen="drawing" {...nav}>
                {/* Canvas fills the space above the tool drawer */}
                <div className="flex-1 min-h-0 px-2 flex items-center justify-center">
                    <SketchCanvas onContentChange={nav.onSketchContentChange} />
                </div>

                {/* Tool panel — styled as a bottom drawer (no drag yet) */}
                <div className="relative shrink-0 flex flex-col gap-2.5 bg-white px-5 pt-6 pb-6 rounded-t-4xl shadow-[0_-4px_20px_rgba(0,0,0,0.08)] overflow-visible after:content-[''] after:pointer-events-none after:absolute after:left-0 after:top-full after:h-24 after:w-full after:bg-white after:rounded-b-4xl">
                    {/* Top controls — undo/redo grouped left, clear + send right */}
                    <div className="flex items-center justify-between">
                        <UndoRedo />
                        <div className="flex items-center gap-1">
                            <ClearCanvas />
                            <SendNote onSent={nav.onNavigate} />
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex-1">
                            <BrushSizeSelector />
                        </div>
                        <ColorPicker />
                    </div>
                    {/* iOS hands color to the native picker (no alpha), so the
                        opacity control lives here instead of in the dialog. */}
                    {isIOS() && <OpacitySlider showLabel={false} />}
                    <ToolSelector />
                </div>
            </Layout>
        </DrawingProvider>
    );
}
