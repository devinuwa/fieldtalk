"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { ModelBanner } from "@/components/ModelBanner";
import { NO_TELEMETRY_NOTE } from "@/lib/strings";

const NAV = [
  { href: "/", label: "Record" },
  { href: "/entries/", label: "Entries" },
  { href: "/ask/", label: "Ask" },
  { href: "/report/", label: "Report" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const current = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href.replace(/\/$/, ""));

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 pb-16 pt-4 print:max-w-none print:px-0 print:pt-0">
      <header className="no-print">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-leaf">FieldTalk</h1>
          <p className="text-sm text-ink-soft">Voice field notebook</p>
        </div>
        <nav
          aria-label="Sections"
          className="no-print mt-3 grid grid-cols-4 gap-1 rounded-xl border border-slate-line bg-surface p-1"
        >
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={current(item.href) ? "page" : undefined}
              className={`rounded-lg px-2 py-2 text-center text-sm font-semibold ${
                current(item.href) ? "bg-leaf/20 text-leaf" : "text-ink-soft hover:text-ink"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <ModelBanner />

      <main className="mt-4 flex-1">{children}</main>

      <footer className="no-print mt-8 border-t border-slate-line pt-3 text-xs text-ink-soft">
        {NO_TELEMETRY_NOTE}
      </footer>
    </div>
  );
}
