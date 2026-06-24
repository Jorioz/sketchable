import type { ReactNode } from "react";

interface HeaderProps {
    leading?: ReactNode;
    title: ReactNode;
    trailing?: ReactNode;
}

// Presentational top bar. The Layout decides what goes in the slots; this just
// keeps the title centered between a leading and trailing action. The fixed-
// width sides keep the title centered even when a slot is empty.
export default function Header({ leading, title, trailing }: HeaderProps) {
    return (
        <div className="flex items-center px-4 py-3 shrink-0">
            <div className="flex w-8 justify-start">{leading}</div>
            <span className="flex-1 text-center text-base font-semibold text-white">
                {title}
            </span>
            <div className="flex w-8 justify-end">{trailing}</div>
        </div>
    );
}
