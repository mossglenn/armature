import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import Link from "next/link";
import { Suspense } from "react";
import { BranchPicker, type BranchChoice } from "./BranchPicker";
import { viewerHub } from "@/lib/viewer";
import "./globals.css";

// The Geist faces from the `geist` package's own files (next/font/local), so
// `next build` needs no network; next/font/google fetched them at build time
// (the deep review's build finding). Same CSS variables as before.
export const metadata: Metadata = {
  title: "Armature",
  description: "Graph-based infrastructure for learning engineering: design intelligence from the artifact graph.",
};

/** The branches the hub lists, for the picker; none when the hub cannot be read, so the page still renders. */
async function branchChoices(): Promise<BranchChoice[]> {
  try {
    const { data } = await viewerHub().branches.list();
    return data.map((b) => ({ name: b.name, head: b.head.commit })).sort((a, b) => (a.name === 'main' ? -1 : b.name === 'main' ? 1 : a.name.localeCompare(b.name)));
  } catch {
    return [];
  }
}

/**
 * The page shell: the viewer's navigation (docs/graph-view-plan.md §5.1) over
 * every page, with the branch picker. The navigation is 3rem tall; the Design
 * Graph sizes itself to the rest of the viewport.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const branches = await branchChoices();
  return (
    <html lang="en">
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} antialiased font-sans`}
      >
        <nav className="flex h-12 items-center gap-5 border-b border-zinc-200 px-4 text-sm dark:border-zinc-800" aria-label="Armature">
          <Link href="/" className="font-semibold tracking-tight">Armature</Link>
          <Link href="/graph" className="text-zinc-600 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100">Design Graph</Link>
          <Link href="/" className="text-zinc-600 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100">Modules</Link>
          {branches.length > 0 && (
            <Suspense fallback={null}>
              <BranchPicker branches={branches} />
            </Suspense>
          )}
        </nav>
        {children}
      </body>
    </html>
  );
}
