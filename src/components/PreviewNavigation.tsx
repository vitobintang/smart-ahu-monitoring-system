"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/alarms", label: "Alarms preview" },
  { href: "/reports", label: "Reports preview" },
  { href: "/simulator", label: "Simulator preview" },
  { href: "/config", label: "Configuration preview" },
  { href: "/trends", label: "Trends preview" },
  { href: "/energy", label: "Energy preview" },
  { href: "/maintenance", label: "Maintenance preview" },
  { href: "/admin", label: "Administration preview" },
  { href: "/audit", label: "Audit preview" },
  { href: "/login", label: "Sign-in preview" },
] as const;

export function PreviewNavigationLinks({
  pathname,
}: {
  pathname: string | null;
}) {
  return (
    <nav aria-label="Main navigation" className="mt-5 lg:mt-8">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-blue-200">
        Preview sections
      </p>

      <div className="mt-3 flex flex-wrap gap-2 lg:flex-col">
        {links.map((link) => {
          const current = pathname === link.href;

          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={current ? "page" : undefined}
              className={`rounded-xl px-3 py-2.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-200 ${
                current
                  ? "bg-blue-500/25 text-white"
                  : "text-blue-100 hover:bg-white/10"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default function PreviewNavigation() {
  const pathname = usePathname();

  return (
    <aside className="bg-[#102747] px-5 py-5 text-white lg:min-h-screen lg:w-60 lg:shrink-0 lg:py-6">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid h-10 w-10 place-items-center rounded-xl bg-blue-500 text-lg font-bold"
        >
          A
        </span>

        <div>
          <p className="text-base font-bold">Smart AHU</p>
          <p className="text-xs text-blue-200">
            Monitoring system
          </p>
        </div>
      </div>

      <PreviewNavigationLinks pathname={pathname} />

      <div className="mt-5 rounded-xl border border-blue-300/20 bg-white/5 p-3 lg:mt-8 lg:p-4">
        <p className="text-sm font-semibold">
          Development preview
        </p>

        <p className="mt-1 text-xs leading-5 text-blue-100">
          Pages are not protected by login. Sign-in is not active yet.
        </p>
      </div>
    </aside>
  );
}