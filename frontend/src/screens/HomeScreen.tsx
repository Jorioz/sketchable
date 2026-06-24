import { useState, type ReactNode } from "react";
import Layout from "../components/Layout";
import SketchDetailDialog from "../components/SketchDetailDialog";
import { useSession } from "../context/SessionContext";
import { useSketchFeed, type FeedSketch } from "../hooks/useSketchFeed";
import { cn } from "../lib/utils";
import type { NavState } from "../navigation";

function Centered({ children }: { children: ReactNode }) {
    return (
        <div className="flex-1 flex items-center justify-center px-6 text-center">
            <p className="text-lg font-medium text-white/80">{children}</p>
        </div>
    );
}

export default function HomeScreen(nav: NavState) {
    const { partnerId, partnerUsername } = useSession();
    const { sketches, loading, error } = useSketchFeed(partnerId);
    const [selected, setSelected] = useState<FeedSketch | null>(null);

    let content: ReactNode;
    if (loading && sketches.length === 0) {
        content = <Centered>Loading sketches…</Centered>;
    } else if (error && sketches.length === 0) {
        content = <Centered>{error}</Centered>;
    } else if (sketches.length === 0) {
        content = <Centered>No sketches yet — draw something to get started.</Centered>;
    } else {
        content = (
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2">
                <ul className="flex flex-col gap-2">
                    {sketches.map((sketch) => (
                        <SketchRow
                            key={`${sketch.from}-${sketch.timestamp}`}
                            sketch={sketch}
                            partnerName={partnerUsername}
                            onSelect={() => setSelected(sketch)}
                        />
                    ))}
                </ul>
            </div>
        );
    }

    return (
        <Layout screen="home" {...nav}>
            {content}
            <SketchDetailDialog sketch={selected} onClose={() => setSelected(null)} />
        </Layout>
    );
}

function SketchRow({
    sketch,
    partnerName,
    onSelect,
}: {
    sketch: FeedSketch;
    partnerName: string;
    onSelect: () => void;
}) {
    const fromPartner = sketch.from === "partner";
    const when = new Date(sketch.timestamp * 1000).toLocaleString();
    return (
        <li>
            <button
                type="button"
                onClick={onSelect}
                className={cn(
                    "flex w-full items-center gap-3 rounded-2xl p-2 text-left transition-transform active:scale-[0.99]",
                    fromPartner ? "bg-blue-500/15" : "bg-white/10",
                )}
            >
                <div className="size-14 shrink-0 overflow-hidden rounded-xl bg-white/5">
                    {sketch.url ? (
                        <img
                            src={sketch.url}
                            alt={`Sketch from ${when}`}
                            className="size-full object-cover"
                            loading="lazy"
                        />
                    ) : (
                        <div className="size-full flex items-center justify-center text-xs text-white/40">
                            N/A
                        </div>
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <p
                        className={cn(
                            "text-sm font-semibold",
                            fromPartner ? "text-blue-200" : "text-white",
                        )}
                    >
                        {fromPartner ? partnerName : "You"}
                    </p>
                    <p className="truncate text-xs text-white/50">{when}</p>
                </div>
            </button>
        </li>
    );
}
