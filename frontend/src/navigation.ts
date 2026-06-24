// App-wide screen navigation. Kept in its own module so screens and the
// Layout/Header can share these types without importing back through App.
export type Screen = "home" | "drawing" | "settings";

export interface NavState {
    /** True once a sketch has been started this session. */
    hasSketch: boolean;
    /** Jump straight to a given screen. */
    onNavigate: (screen: Screen) => void;
    /** Start a fresh sketch and open the canvas. */
    onNewSketch: () => void;
    /** Keep the home chrome in sync with whether the canvas actually has content. */
    onSketchContentChange: (hasContent: boolean) => void;
    /** Return to the screen the current one was opened from. */
    onBack: () => void;
}
