import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI-UD | Underwriting Dispatcher",
  description: "AI-Underwriting Dispatcher -- intelligent workload balancing & skill-based automated routing"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* AppShell lives in the persistent layout so the sidebar / role switcher is
            mounted once and survives every page navigation. Wrapping it per-page
            remounted it on each route change, which reset the role state and made the
            user/admin toggle flicker. */}
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
