/**
 * The hub as its own process: the Armature API served by Node's HTTP server
 * (ADR-0026 decision 4, ADR-0054, built in Phase 7).
 *
 * `app/lib/api/app.ts` is host-neutral; this module is its host. (Until
 * 2026-10-21 Next.js was a second host through a catch-all route; the pages
 * are now a client of the hub through `lib/viewer.ts`, so there is one hub.)
 * The Node adapter (`@hono/node-server`) turns Node's request and response
 * objects into the web-standard ones the app is written against.
 *
 * `startHub` is separate from the entry file (`app/server.ts`) so a test can
 * start the server on an ephemeral port and compare its answers with
 * `app.request()`, and so the entry stays a few lines of environment reading.
 * Nothing here reads the environment: the port and host are arguments, and so
 * is the configuration when a caller gives one, so a test can start a second
 * hub on another store beside the first (docs/workspace-hub-plan.md §13).
 */
import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import { app, createApp } from './api/app';
import type { HubConfig } from './api/config';
import { CURRENT_REVISION } from './api/version';

export interface HubOptions {
  /** The port to listen on; 0 asks the operating system for a free one. */
  port: number;
  /**
   * The interface to bind. Loopback by default: the `header` identity resolver
   * trusts the caller (ADR-0032), so a hub other machines can reach lets anyone
   * write as anyone. A container binds `0.0.0.0` inside its own network and the
   * compose file decides what the host publishes.
   */
  hostname?: string;
  /** This hub's configuration; the environment's, read on every request, when absent. */
  config?: HubConfig;
}

export interface RunningHub {
  /** The port the server is listening on (useful when 0 was asked for). */
  port: number;
  /** The address a client uses from the same machine. */
  url: string;
  /** The contract revision this hub serves (ADR-0059). */
  revision: string;
  /** Stops accepting connections and resolves once the server is closed. */
  close: () => Promise<void>;
}

/** Starts the hub and resolves once it is listening. */
export function startHub({ port, hostname = '127.0.0.1', config }: HubOptions): Promise<RunningHub> {
  const hub = config ? createApp(() => config) : app;
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: hub.fetch, port, hostname }, (info: AddressInfo) => {
      const host = info.address === '0.0.0.0' || info.address === '::' ? 'localhost' : info.address;
      resolve({
        port: info.port,
        url: `http://${host}:${info.port}`,
        revision: CURRENT_REVISION,
        close: () =>
          new Promise<void>((done, fail) => server.close((err) => (err ? fail(err) : done()))),
      });
    });
    server.once('error', reject);
  });
}
