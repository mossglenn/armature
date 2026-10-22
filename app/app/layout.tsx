import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Armature",
  description: "Graph-based infrastructure for learning engineering: design intelligence from the artifact graph.",
};

/**
 * The page shell: the viewer's navigation (docs/graph-view-plan.md §5.1) over
 * every page. The navigation is 3rem tall; the Design Graph sizes itself to
 * the rest of the viewport.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased font-sans`}
      >
        <nav className="flex h-12 items-center gap-5 border-b border-zinc-200 px-4 text-sm dark:border-zinc-800" aria-label="Armature">
          <Link href="/" className="font-semibold tracking-tight">Armature</Link>
          <Link href="/graph" className="text-zinc-600 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100">Design Graph</Link>
          <Link href="/" className="text-zinc-600 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100">Modules</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
