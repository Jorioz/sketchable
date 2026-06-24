import FullScreen from "../components/FullScreen";

// First-run / signed-out intro. Just the brand and a Continue button — the
// actual device setup and Google sign-in happen on the next step (SetupScreen).
export default function OnboardingScreen({
    onContinue,
}: {
    onContinue: () => void;
}) {
    return (
        <FullScreen>
            {/* Hero */}
            <div className="flex-1 flex flex-col items-center justify-center gap-5 text-center">
                <img
                    src="/sketchable-banner.png"
                    alt="Sketchable"
                    className="h-16 w-auto"
                />
                <p className="max-w-xs text-balance text-base text-white/70 absolute top-1/2 pt-4">
                    by Jorio
                </p>
            </div>

            {/* Get started */}
            <div className="pb-2">
                <button
                    type="button"
                    onClick={onContinue}
                    className="flex w-full items-center justify-center gap-3 rounded-full bg-white px-5 py-3.5 text-base font-semibold text-gray-900 transition-transform active:scale-[0.98]"
                >
                    Continue
                </button>
            </div>
        </FullScreen>
    );
}
