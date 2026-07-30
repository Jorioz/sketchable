import { cn } from "../lib/utils";

// The one spinner for the whole app: a looping animated pencil sketch.
// The source GIF is 50×50, so `size` defaults to its natural pixel size to
// keep it crisp; pass a smaller number for inline use.
export default function Loader({
    size = 50,
    className,
}: {
    size?: number;
    className?: string;
}) {
    return (
        <img
            src="/sketchable-loader.gif"
            // Decorative — every usage pairs it with a visible text label.
            alt=""
            aria-hidden="true"
            width={size}
            height={size}
            style={{ width: size, height: size }}
            className={cn("shrink-0 select-none", className)}
        />
    );
}
