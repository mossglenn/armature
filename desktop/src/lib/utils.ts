import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Quiver's helper, so its components (src/components/ui/) travel unchanged. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));

/** The first seven characters of a commit id, as the pages show one. */
export const shortCommit = (commit: string): string => commit.slice(0, 7);
