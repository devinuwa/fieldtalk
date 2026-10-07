import type { Metadata, Viewport } from "next";

import { AppShell } from "@/components/AppShell";
import { AppProvider } from "@/lib/store";

import "./globals.css";

export const metadata: Metadata = {
  title: "FieldTalk",
  description:
    "An offline voice field notebook: record a note, review the extracted entry, ask your notes, print the week.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppProvider>
          <AppShell>{children}</AppShell>
        </AppProvider>
      </body>
    </html>
  );
}
