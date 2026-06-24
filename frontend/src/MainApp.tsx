import { useState } from "react";
import DrawingScreen from "./screens/DrawingScreen";
import HomeScreen from "./screens/HomeScreen";
import SettingsScreen from "./screens/SettingsScreen";
import type { NavState, Screen } from "./navigation";
import { cn } from "@/lib/utils";

// The authenticated, paired app: the original screen-switching shell. Rendered
// by App.tsx only once a user is signed in (Auth0) and bound to a partner, with
// the active session available via SessionContext.
export default function MainApp() {
    const [screen, setScreen] = useState<Screen>("home");
    const [prevScreen, setPrevScreen] = useState<Screen>("home");
    const [hasSketch, setHasSketch] = useState(false);

    function navigate(next: Screen) {
        setPrevScreen(screen);
        setScreen(next);
    }

    function newSketch() {
        navigate("drawing");
    }

    const nav: NavState = {
        hasSketch,
        onNavigate: navigate,
        onNewSketch: newSketch,
        onSketchContentChange: setHasSketch,
        onBack: () => navigate(prevScreen),
    };

    return (
        <div
            className={cn(
                "relative w-dvw h-dvh",
                screen === "drawing" ? "overflow-visible" : "overflow-hidden",
            )}
        >
            {/* Drawing screen stays mounted so the fabric canvas + in-progress
                sketch survive navigation. We toggle visibility (not display) to
                keep the canvas dimensions intact — `display:none` would collapse
                it to 0 and force a costly re-measure/re-render on return.
                `invisible` also drops it from pointer/tab interaction. */}
            <div
                className={cn(
                    "absolute inset-0",
                    screen !== "drawing" && "invisible",
                )}
            >
                <DrawingScreen {...nav} />
            </div>

            {/* Placeholder screens hold no state, so they mount on demand as
                overlays rather than living permanently behind the canvas. */}
            {screen === "home" && (
                <div className="absolute inset-0">
                    <HomeScreen {...nav} />
                </div>
            )}
            {screen === "settings" && (
                <div className="absolute inset-0">
                    <SettingsScreen {...nav} />
                </div>
            )}
        </div>
    );
}
