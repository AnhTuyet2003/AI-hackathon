import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#18212f",
        muted: "#667085",
        line: "#d8dee8",
        udblue: "#255f9f",
        udnavy: "#17212f",
        udgreen: "#1f7a5b",
        udamber: "#a35f00",
        udred: "#b42318",
        udpurple: "#5b3ea6"
      },
      boxShadow: {
        ud: "0 1px 2px rgba(16, 24, 40, 0.06), 0 1px 3px rgba(16, 24, 40, 0.10)"
      }
    }
  },
  plugins: []
};

export default config;
