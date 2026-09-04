import { createTheme } from "@mantine/core";

/**
 * Shared SaaS design layer (V2 §8) for both consoles. Components stay
 * Mantine primitives; this only sets type, radius and brand semantics.
 */
export const appTheme = createTheme({
  fontFamily:
    "system-ui, -apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
  headings: {
    fontFamily: "Georgia, 'Newsreader', 'Noto Serif SC', 'Songti SC', serif",
    fontWeight: "600",
  },
  defaultRadius: "md",
  colors: {
    brand: [
      "#f5f4f2", "#e7e4de", "#d3cdc2", "#b8ae9e", "#9a8d78",
      "#7d7261", "#655c4e", "#4f483e", "#38332c", "#211e19",
    ],
  },
  primaryColor: "brand",
  primaryShade: 8,
});
