// Catppuccin Mocha palette — semantic color names for easy theme swapping later
export interface ThemeColors {
  primary: string;   // focus borders, active items
  success: string;   // done, passing
  warning: string;   // in-progress, pending
  error: string;     // blocked, failed
  text: string;      // primary text
  subtext: string;   // secondary text
  dim: string;       // disabled, borders
  accent: string;    // branch names, highlights
  surface: string;   // panel backgrounds
}

export interface Theme {
  name: string;
  colors: ThemeColors;
  border: "round" | "single" | "double" | "bold";
  icons: {
    active: string;
    working: string;
    idle: string;
    done: string;
    blocked: string;
    cursor: string;
    selected: string;
    unselected: string;
  };
  progress: {
    filled: string;
    empty: string;
  };
}

export const catppuccin: Theme = {
  name: "catppuccin",
  colors: {
    primary: "#89dceb",   // cyan
    success: "#a6e3a1",   // green
    warning: "#f9e2af",   // yellow
    error: "#f38ba8",     // red
    text: "#cdd6f4",      // text
    subtext: "#a6adc8",   // subtext0
    dim: "#585b70",       // surface2
    accent: "#cba6f7",    // mauve
    surface: "#313244",   // surface0
  },
  border: "round",
  icons: {
    active: "●",
    working: "◍",
    idle: "○",
    done: "✓",
    blocked: "⊘",
    cursor: "▸",
    selected: "☑",
    unselected: "☐",
  },
  progress: {
    filled: "█",
    empty: "░",
  },
};

// Active theme — will support runtime switching later
export const theme = catppuccin;
export const C = theme.colors;
export const I = theme.icons;
