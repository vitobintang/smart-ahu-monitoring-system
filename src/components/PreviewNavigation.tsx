"use client";

import React, { useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const groups = [
  {
    label: "Overview",
    links: [{ href: "/", label: "Dashboard" }],
  },
  {
    label: "Monitoring",
    links: [
      { href: "/alarms", label: "Alarms preview" },
      { href: "/reports", label: "Reports preview" },
      { href: "/trends", label: "Trends preview" },
      { href: "/energy", label: "Energy preview" },
      { href: "/maintenance", label: "Maintenance preview" },
      { href: "/simulator", label: "Simulator preview" },
      {
        href: "/simulator/commands",
        label: "Command practice",
      },
    ],
  },
  {
    label: "Management",
    links: [
      { href: "/config", label: "Configuration preview" },
      { href: "/admin", label: "Administration preview" },
      { href: "/audit", label: "Audit preview" },
      { href: "/login", label: "Sign-in preview" },
    ],
  },
] as const;

export function PreviewNavigationLinks({
  pathname,
  onNavigate,
}: {
  pathname: string | null;
  onNavigate?: () => void;
}) {
  return (
    <nav
      aria-label="Main navigation"
      className="mt-5 space-y-4 lg:mt-8"
    >
      {groups.map((group) => (
        <div key={group.label}>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-blue-200">
            {group.label}
          </p>

          <div className="mt-2 flex flex-wrap gap-2 lg:flex-col lg:gap-1">
            {group.links.map((link) => {
              const current = pathname === link.href;

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={onNavigate}
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
        </div>
      ))}
    </nav>
  );
}

export function PreviewNavigationContent({
  pathname,
}: {
  pathname: string | null;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <aside
      className="bg-[#102747] px-5 py-5 text-white lg:min-h-screen lg:w-60 lg:shrink-0 lg:py-6"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}
    >
      <div className="flex items-center justify-between gap-3">
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

        <button
          ref={buttonRef}
          type="button"
          aria-expanded={open}
          aria-controls="preview-navigation-links"
          onClick={() => setOpen((value) => !value)}
          className="rounded-lg border border-blue-300/50 px-3 py-2 text-sm font-semibold text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-200 lg:hidden"
        >
          {open ? "Close menu" : "Open menu"}
        </button>
      </div>

      <div
        id="preview-navigation-links"
        className={open ? "block" : "hidden lg:block"}
      >
        <PreviewNavigationLinks
          pathname={pathname}
          onNavigate={() => setOpen(false)}
        />
      </div>

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

export default function PreviewNavigation() {
  const pathname = usePathname();

  return (
    <PreviewNavigationContent
      key={pathname ?? ""}
      pathname={pathname}
    />
  );
}