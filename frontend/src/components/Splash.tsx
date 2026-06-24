import { IoEllipse } from "react-icons/io5";
import FullScreen from "./FullScreen";

// Lightweight loading state shown while Auth0 restores a session or the pairing
// status is being fetched.
export default function Splash({ label = "Loading…" }: { label?: string }) {
    return (
        <FullScreen>
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
                <IoEllipse className="size-4 text-blue-400 animate-ping" />
                <p className="text-sm font-medium text-white/70">{label}</p>
            </div>
        </FullScreen>
    );
}
