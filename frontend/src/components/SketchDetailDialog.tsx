import { useState } from "react";
import { IoDownloadOutline } from "react-icons/io5";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { useSession } from "../context/SessionContext";
import type { FeedSketch } from "../hooks/useSketchFeed";

/**
 * Enlarged view of a single sketch, opened from the Home feed. Controlled by the
 * caller: pass the selected sketch (or `null` to close) and an `onClose`. Offers
 * a download that forces a save rather than navigating to the image.
 */
export default function SketchDetailDialog({
    sketch,
    onClose,
}: {
    sketch: FeedSketch | null;
    onClose: () => void;
}) {
    const { partnerUsername } = useSession();
    const [downloading, setDownloading] = useState(false);

    async function handleDownload() {
        if (!sketch?.url) return;
        setDownloading(true);
        try {
            // Fetch the bytes so the browser saves the file instead of just
            // navigating. CloudFront serves a different origin, so this needs
            // CORS on the bucket/distribution; if it's blocked we fall back to
            // opening the image in a new tab for a manual save.
            const resp = await fetch(sketch.url);
            const blob = await resp.blob();
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = objectUrl;
            a.download = `sketch-${sketch.timestamp}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(objectUrl);
        } catch {
            window.open(sketch.url, "_blank", "noopener,noreferrer");
        } finally {
            setDownloading(false);
        }
    }

    const fromPartner = sketch?.from === "partner";
    const when = sketch ? new Date(sketch.timestamp * 1000).toLocaleString() : "";

    return (
        <Dialog
            open={sketch !== null}
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
        >
            <DialogContent>
                {sketch && (
                    <>
                        <DialogHeader>
                            <DialogTitle>{fromPartner ? partnerUsername : "You"}</DialogTitle>
                            <DialogDescription>{when}</DialogDescription>
                        </DialogHeader>

                        <div className="aspect-square w-full overflow-hidden rounded-2xl bg-white/5">
                            {sketch.url ? (
                                <img
                                    src={sketch.url}
                                    alt={`Sketch from ${when}`}
                                    className="size-full object-contain"
                                />
                            ) : (
                                <div className="size-full flex items-center justify-center text-sm text-white/40">
                                    Image unavailable
                                </div>
                            )}
                        </div>

                        <DialogFooter showCloseButton>
                            <Button
                                onClick={handleDownload}
                                disabled={!sketch.url || downloading}
                            >
                                <IoDownloadOutline />
                                {downloading ? "Downloading…" : "Download"}
                            </Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
