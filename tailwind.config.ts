import type { Config } from "tailwindcss";

/**
 * Design token 直接沿用 docs/design/aidit-demo-v5.html 的 CSS 變數。
 * 顏色以 CSS 變數為單一事實來源（globals.css :root），此處僅建立 Tailwind 別名，
 * 避免同一個色票在兩個地方各寫一份而走鐘。
 */
const token = (name: string) => `var(--${name})`;

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: token("ink"), 2: token("ink-2"), 3: token("ink-3"), 4: token("ink-4") },
        paper: token("paper"),
        surface: { DEFAULT: token("surface"), 2: token("surface-2") },
        line: { DEFAULT: token("line"), 2: token("line-2") },
        text: { DEFAULT: token("text"), 2: token("text-2"), 3: token("text-3") },
        link: token("link"),
        ok: { DEFAULT: token("ok"), bg: token("ok-bg"), line: token("ok-line") },
        unmet: { DEFAULT: token("unmet"), bg: token("unmet-bg"), line: token("unmet-line") },
        hold: { DEFAULT: token("hold"), bg: token("hold-bg"), line: token("hold-line") },
      },
      fontFamily: {
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
        sans: ["Noto Sans TC", "system-ui", "sans-serif"],
      },
      maxWidth: { shell: "1180px" },
    },
  },
  plugins: [],
} satisfies Config;
