import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smart Monitoring AHU — Air Handling Unit Monitoring & Control System",
  description:
    "Industrial monitoring and control platform for 7 Air Handling Units: live telemetry, alarms, trend proximity estimation, data-logger reports and RBAC-secured control.",
};

export const viewport: Viewport = {
  themeColor: "#050b14",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ink-950 text-slate-200 antialiased">{children}</body>
    </html>
  );
}