import { createContext, useContext } from 'react';
import type { ShellState } from '@/lib/backend';
import type { Settings } from '@/lib/types';

/**
 * The instance's own name, which every sentence that names the shared installation uses
 * (`@armature/vocabulary`, the terms `instance.own-name` and `instance`; docs/naming-vocabulary.md
 * §4): "Changed on Westfield Armature", never "the remote". The name is the one the instance gave
 * for itself and the person confirmed when connecting, kept in the settings, which every reply of
 * the core's `start` carries. Before a connection, or for an instance that gave none, the general
 * word stands: "your instance".
 */
export const GENERAL = 'your instance';

export const instanceName = (state?: ShellState): string => (state?.started?.settings as Settings | undefined)?.instance?.name ?? GENERAL;

const InstanceName = createContext(GENERAL);

/** Set once, around the pages, by the window. */
export const InstanceProvider = InstanceName.Provider;

/** The name as a sentence uses it in its middle: "pushed to Westfield Armature", "pushed to your instance". */
export const useInstance = (): string => useContext(InstanceName);

/** The name where it begins a sentence: "Your instance cannot be reached". An instance's own name is written as it gave it, a host name too. */
export const sentence = (name: string): string => (name === GENERAL ? 'Your instance' : name);
