import type { ReactNode } from "react";

import PreviewNavigation from "../components/PreviewNavigation";
import "./globals.css";

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen bg-[#eef3fa] lg:flex">
          <PreviewNavigation />

          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </body>
    </html>
  );
}