import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI-UD | Underwriting Dispatcher",
  description: "AI-Underwriting Dispatcher -- intelligent workload balancing & skill-based automated routing"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
