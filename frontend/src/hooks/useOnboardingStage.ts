import { useCallback, useState } from "react";

// The pre-account onboarding runs in three stages:
//
//   login → the intro screen (banner + Continue)
//   setup → the device-setup checklist (add to Home Screen, Scriptable, sign in,
//           copy the widget script)
//   done  → onboarding finished; hand off to the normal username/pairing gate
//
// Only "setup" is persisted to localStorage, and only because signing in with
// Google redirects away to Auth0 and reloads the app on return — without
// persistence we'd lose our place across that round trip. "done" is
// deliberately NOT persisted: it's reached by tapping Continue on the setup
// checklist, which involves no redirect, so session state is enough. Persisting
// it would make every later sign-in skip the checklist and jump straight to
// pairing — the Continue button, not the act of signing in, is what should
// advance past setup.
export type OnboardingStage = "login" | "setup" | "done";

const KEY = "sketchable.onboarding";

function read(): OnboardingStage {
    // Only "setup" is a meaningful persisted value; anything else (including a
    // legacy persisted "done") starts the user back at the intro/checklist.
    return localStorage.getItem(KEY) === "setup" ? "setup" : "login";
}

export function useOnboardingStage() {
    const [stage, setStage] = useState<OnboardingStage>(read);

    const advance = useCallback((next: OnboardingStage) => {
        // Persist only the redirect-spanning "setup" stage; clear the key
        // otherwise so "done" never sticks across sessions/reloads.
        if (next === "setup") {
            localStorage.setItem(KEY, next);
        } else {
            localStorage.removeItem(KEY);
        }
        setStage(next);
    }, []);

    return { stage, advance };
}
