import type { ReactNode } from "react";

// Full-viewport, screen-width column on the app's deep-blue background. Shared
// by the pre-app gate screens (splash, onboarding, pairing, notices) so they
// match the chrome of the main app's Layout.
export default function FullScreen({ children }: { children: ReactNode }) {
    return (
        <div
            className="w-dvw h-dvh flex flex-col items-center bg-blue-950 overflow-hidden"
            style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
            <div
                className="w-full max-w-screen-sm flex flex-1 flex-col px-6 py-8 overflow-y-auto"
                style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            >
                {children}
            </div>
        </div>
    );
}
