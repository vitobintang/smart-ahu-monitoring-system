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
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:font-bold focus:text-blue-900 focus:shadow-lg focus:outline-2 focus:outline-offset-2 focus:outline-blue-700 print:hidden"
        >
          Skip to page content
        </a>

        <div className="min-h-screen bg-[#eef3fa] lg:flex">
          <PreviewNavigation />

          <div
            id="main-content"
            tabIndex={-1}
            className="min-w-0 flex-1 focus:outline-2 focus:outline-offset-2 focus:outline-blue-700"
          >
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}