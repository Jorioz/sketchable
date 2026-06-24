import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * True on iOS/iPadOS. Detects classic iPhone/iPad/iPod user agents as well as
 * iPadOS 13+, which masquerades as "MacIntel" but is the only Mac platform
 * reporting multi-touch.
 */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  )
}
