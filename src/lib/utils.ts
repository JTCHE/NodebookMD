import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// The type scale and the spacing scale in globals.css (`--text-*`,
// `--spacing-*`) name values the merge does not know. Unknown, `text-caption`
// reads as a colour, and a `text-neutral-500` after it removed the size; and
// `pl-sm` does not conflict with `pl-[80px]`, so both stay and the CSS order
// picks one. Keep these lists in step with the tokens in globals.css.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["display", "lede", "title", "label", "meta", "caption", "row"],
      spacing: ["thin", "light", "2xs", "xs", "sm", "ms", "md", "lg", "xl", "2xl", "3xl", "4xl", "icon", "glyph"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
