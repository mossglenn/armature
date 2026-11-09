import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Quiver's helper, so its components (src/components/ui/) travel unchanged. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));

/** The first seven characters of a commit id, as the pages show one. */
export const shortCommit = (commit: string): string => commit.slice(0, 7);

/**
 * For a field whose text is a name, an address or an identifier, kept exactly as typed: macOS's
 * webview capitalizes a field's first letter and may correct a word, which turned a workspace named
 * `kc-rehearsal` into the branch `…_Kc-rehearsal` in the Keycloak rehearsal (2026-11-08). Spread
 * onto the input; prose fields (a commit's message) keep the system's help.
 */
export const verbatim = { autoCapitalize: 'off', autoCorrect: 'off', autoComplete: 'off', spellCheck: false } as const;
