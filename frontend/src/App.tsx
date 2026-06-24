import { useAuth0 } from "@auth0/auth0-react";
import MainApp from "./MainApp";
import OnboardingScreen from "./screens/OnboardingScreen";
import SetupScreen from "./screens/SetupScreen";
import UsernameScreen from "./screens/UsernameScreen";
import PairingScreen from "./screens/PairingScreen";
import Splash from "./components/Splash";
import Notice from "./components/Notice";
import { SessionProvider } from "./context/SessionContext";
import { usePairing } from "./hooks/usePairing";
import {
    useOnboardingStage,
    type OnboardingStage,
} from "./hooks/useOnboardingStage";
import { setTokenProvider } from "./lib/api";
import { isAuth0Configured } from "./lib/config";

// App entry. `App` itself calls no hooks before the config check, so it's safe
// to render outside the Auth0Provider when Auth0 isn't configured yet.
export default function App() {
    if (!isAuth0Configured) {
        return (
            <Notice
                title="Auth isn't configured yet"
                message="Set VITE_AUTH0_DOMAIN and VITE_AUTH0_CLIENT_ID in frontend/.env, then restart the dev server. See README for Auth0 setup steps."
            />
        );
    }
    return <AuthGate />;
}

// Stage 1: intro + Auth0 sign-in. A brand-new, signed-out visitor sees the
// intro, then the device-setup checklist (which is where Google sign-in lives).
// Once signed in, the *server's pairing status* — not a local flag — decides
// whether the user still needs onboarding, so returning paired users skip
// straight to the app instead of re-walking the checklist on every launch.
function AuthGate() {
    const { isLoading, isAuthenticated, error, getAccessTokenSilently } =
        useAuth0();
    const { stage, advance } = useOnboardingStage();

    if (isLoading) return <Splash label="Loading…" />;
    if (error) {
        return <Notice title="Sign-in failed" message={error.message} />;
    }

    // --- Signed out -------------------------------------------------------
    // Intro screen, shown until the user taps Continue into the checklist.
    if (!isAuthenticated && stage === "login") {
        return <OnboardingScreen onContinue={() => advance("setup")} />;
    }
    // Setup checklist (signed out) — this is where the Google sign-in button is.
    if (!isAuthenticated) {
        return (
            <SetupScreen
                onContinue={() => advance("done")}
                onBack={() => advance("login")}
            />
        );
    }

    // --- Signed in --------------------------------------------------------
    // Give the API client a token source before any authed subtree mounts so
    // even the setup checklist can call authenticated endpoints (e.g. minting
    // the widget's script token).
    setTokenProvider(() => getAccessTokenSilently());
    return (
        <OnboardedGate
            stage={stage}
            onSetupDone={() => advance("done")}
            onBackToIntro={() => advance("login")}
        />
    );
}

// Stage 2: pairing is the source of truth. We load the pairing record once and
// branch on it:
//   • already paired → into the app (returning users never re-see setup);
//   • signed in but not yet paired → finish the setup checklist (so the user can
//     copy their widget script) until they tap Continue this session, then pick
//     a username and pair. Pairing status is polled, so a partner redeeming this
//     user's code advances them automatically. Identity comes from the token.
function OnboardedGate({
    stage,
    onSetupDone,
    onBackToIntro,
}: {
    stage: OnboardingStage;
    onSetupDone: () => void;
    onBackToIntro: () => void;
}) {
    const { loginWithRedirect } = useAuth0();
    const { pairing, loading, error, sessionExpired, refresh } = usePairing();

    if (loading && !pairing) return <Splash label="Setting things up…" />;
    if (error && !pairing) {
        // A silently-refreshed token that failed (expired session) can't be
        // recovered by retrying the same fetch — send the user back through an
        // interactive Google sign-in instead.
        if (sessionExpired) {
            return (
                <Notice
                    title="Couldn't load your account"
                    message={error}
                    retryLabel="Sign in again"
                    onRetry={() =>
                        void loginWithRedirect({
                            authorizationParams: { connection: "google-oauth2" },
                        })
                    }
                />
            );
        }
        return (
            <Notice
                title="Couldn't load your account"
                message={error}
                onRetry={refresh}
            />
        );
    }
    if (!pairing) return <Splash />;

    // Already set up → into the app. (A paired user always has a username, but
    // guard anyway in case of a partially-provisioned record.)
    if (pairing.paired) {
        if (!pairing.username) return <UsernameScreen onRefresh={refresh} />;
        return (
            <SessionProvider userId={pairing.userId} pairing={pairing}>
                <MainApp />
            </SessionProvider>
        );
    }

    // Signed in but not paired yet. Keep showing the checklist (now with the
    // copy-script step unlocked) until the user confirms with Continue.
    if (stage !== "done") {
        return <SetupScreen onContinue={onSetupDone} onBack={onBackToIntro} />;
    }

    if (!pairing.username) {
        return <UsernameScreen onRefresh={refresh} />;
    }
    return <PairingScreen pairing={pairing} onRefresh={refresh} />;
}
