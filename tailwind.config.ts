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
        ud: "0 16px 40px rgba(28, 39, 52, 0.10)"
      }
    }
  },
  plugins: []
};

export default config;
