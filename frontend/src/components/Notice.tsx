import { IoAlertCircleOutline } from "react-icons/io5";
import FullScreen from "./FullScreen";

// Full-screen message used by the gate for unrecoverable-ish states: a missing
// config, a failed login, or a pairing-status fetch that errored. `onRetry`
// renders a retry button when provided.
export default function Notice({
    title,
    message,
    onRetry,
    retryLabel = "Try again",
}: {
    title: string;
    message: string;
    onRetry?: () => void;
    retryLabel?: string;
}) {
    return (
        <FullScreen>
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
                <IoAlertCircleOutline className="size-10 text-blue-300" />
                <h1 className="text-lg font-semibold text-white">{title}</h1>
                <p className="max-w-xs text-sm text-white/70">{message}</p>
                {onRetry && (
                    <button
                        type="button"
                        onClick={onRetry}
                        className="mt-2 rounded-full bg-blue-500 px-5 py-2 text-sm font-semibold text-white transition-transform active:scale-95"
                    >
                        {retryLabel}
                    </button>
                )}
            </div>
        </FullScreen>
    );
}
