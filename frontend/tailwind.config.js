/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F4F6F4",
        paperDim: "#EBEEEA",
        ink: "#16302B",
        inkSoft: "#3F5651",
        sage: {
          50: "#EEF4F0",
          100: "#D6E6DA",
          300: "#8FB89C",
          500: "#2F6F4E",
          600: "#265B40",
          700: "#1D4631",
        },
        clay: {
          400: "#D98452",
          500: "#C7622D",
          600: "#A54F24",
        },
        line: "#DCE3DD",
      },
      fontFamily: {
        display: ["Fraunces", "serif"],
        body: ["Inter", "sans-serif"],
        mono: ["IBM Plex Mono", "monospace"],
      },
      borderRadius: {
        card: "10px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(22, 48, 43, 0.06), 0 8px 24px -12px rgba(22, 48, 43, 0.12)",
      },
    },
  },
  plugins: [],
};
