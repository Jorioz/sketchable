import type { ReactNode } from "react";
import {
    IoAdd,
    IoArrowBack,
    IoHomeOutline,
    IoSettingsOutline,
} from "react-icons/io5";
import Header from "./Header";
import type { NavState, Screen } from "../navigation";

type LayoutProps = NavState & {
    screen: Screen;
    children: ReactNode;
};

function IconButton({
    label,
    onClick,
    children,
}: {
    label: string;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            className="flex items-center justify-center w-8 h-8 rounded-full text-white transition-transform active:scale-90"
        >
            {children}
        </button>
    );
}

// App chrome: a screen-width column with an adaptive header on top and the
// active screen's content below. The header's title and leading button change
// per screen — and on home, per whether a sketch is already in session.
export default function Layout({
    screen,
    hasSketch,
    onNavigate,
    onNewSketch,
    onBack,
    children,
}: LayoutProps) {
    let title: ReactNode = "";
    let leading: ReactNode = null;
    // Settings is reachable from every other screen, so it's the default
    // trailing action — cleared on the settings screen itself.
    let trailing: ReactNode = (
        <IconButton label="Settings" onClick={() => onNavigate("settings")}>
            <IoSettingsOutline className="size-5" />
        </IconButton>
    );

    switch (screen) {
        case "home":
            title = (
                <img
                    src="/sketchable-banner.png"
                    alt="Sketchable"
                    className="mx-auto h-7 w-auto"
                />
            );
            // Once a sketch is in session, the "+" becomes a way back to it.
            leading = hasSketch ? (
                <IconButton
                    label="Back to sketch"
                    onClick={() => onNavigate("drawing")}
                >
                    <IoArrowBack className="size-5" />
                </IconButton>
            ) : (
                <IconButton label="New sketch" onClick={onNewSketch}>
                    <IoAdd className="size-6" />
                </IconButton>
            );
            break;
        case "drawing":
            title = "new sketch";
            leading = (
                <IconButton label="Home" onClick={() => onNavigate("home")}>
                    <IoHomeOutline className="size-5" />
                </IconButton>
            );
            break;
        case "settings":
            title = "settings";
            leading = (
                <IconButton label="Back" onClick={onBack}>
                    <IoArrowBack className="size-5" />
                </IconButton>
            );
            trailing = null;
            break;
    }

    const allowOverflow = screen === "drawing";

    return (
        <div
            className={`w-dvw h-dvh flex flex-col items-center bg-blue-950 ${allowOverflow ? "overflow-visible" : "overflow-hidden"}`}
            style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
            <div
                className={`w-full max-w-screen-sm flex flex-col flex-1 gap-3 ${allowOverflow ? "overflow-visible" : "overflow-hidden"}`}
            >
                <Header leading={leading} title={title} trailing={trailing} />
                <div
                    className={`flex-1 min-h-0 flex flex-col gap-3 ${allowOverflow ? "overflow-visible" : "overflow-hidden"}`}
                >
                    {children}
                </div>
            </div>
        </div>
    );
}
