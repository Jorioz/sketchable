import { useState } from "react";
import { IoSend } from "react-icons/io5";
import { useDrawing } from "../context/DrawingContext";
import { uploadSketch, ApiError } from "../lib/api";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { Screen } from "../navigation";

// Solo send button — flattens the sketch and uploads it to the shared pair
// stream after a confirm prompt. Muted until something has been drawn.
export default function SendNote({
    onSent,
}: {
    onSent: (screen: Screen) => void;
}) {
    const { canUndo, handleExport, handleClear } = useDrawing();
    const [open, setOpen] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSend() {
        const image = handleExport();
        if (!image) {
            setError("Nothing to send yet.");
            return;
        }

        setSending(true);
        setError(null);
        try {
            await uploadSketch(image);
            handleClear(); // fresh pad after a successful send
            setOpen(false);
            onSent("home");
        } catch (e) {
            setError(
                e instanceof ApiError
                    ? e.message
                    : "Couldn't send. Please try again.",
            );
        } finally {
            setSending(false);
        }
    }

    return (
        <div className="rounded-full bg-black/5 p-1">
            <AlertDialog
                open={open}
                onOpenChange={(next) => {
                    // Don't let the dialog close mid-send; reset error when reopening.
                    if (sending) return;
                    setOpen(next);
                    if (next) setError(null);
                }}
            >
                <AlertDialogTrigger
                    disabled={!canUndo}
                    aria-label="Send"
                    className="flex items-center justify-center w-8 h-8 rounded-full text-blue-500 transition-transform active:scale-90 disabled:opacity-30"
                >
                    <IoSend className="size-[18px]" />
                </AlertDialogTrigger>
                <AlertDialogContent size="sm">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Send note?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This sends your sketch to your partner and clears
                            the pad.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {error && (
                        <p className="text-sm text-destructive">{error}</p>
                    )}
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={sending}>
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => {
                                // Keep the dialog open while the upload is in flight.
                                e.preventDefault();
                                void handleSend();
                            }}
                            disabled={sending}
                        >
                            {sending ? "Sending…" : "Send"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
