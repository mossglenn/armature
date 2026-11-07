import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { ApiError } from '../api/errors';

/**
 * The control protocol between the desktop program's shell and its core
 * (ADR-0069 decision 3; docs/desktop-program-plan.md §5).
 *
 * JSON, one object per line: requests on the core's standard input, replies
 * and events on its standard output. A child's pipes are readable by its
 * parent alone, so nothing here crosses the network or a file, and the
 * credentials the shell's keychain holds travel this way rather than in the
 * core's arguments or environment.
 *
 *   request  { "id": 7, "type": "push", ...fields }
 *   reply    { "id": 7, "status": 200, "body": { ... } }
 *   event    { "event": "log", ...fields }
 *
 * A reply is what `app.request()` would answer, its status and its JSON body,
 * so a refusal is the route's own: `{ error, message, ...details }` with the
 * route's status, as `app.onError` renders an `ApiError`. The shell's pages
 * then read a reply as they would read a response, and the suites'
 * expectations apply to both. Requests run concurrently (a push can take
 * seconds; the shell may ask for a status meanwhile), so replies come in the
 * order work finishes and the `id` pairs them. Events carry no `id`; one that
 * belongs to a request names it as `request` (sign-in's `open`).
 *
 * A line that is not a request is answered with `id: null`, 400
 * `bad_request`, and the channel goes on: the shell is trusted, and a
 * malformed line is a bug to see in the log, not a reason to stop the hub.
 * The input's end is the shell gone (ADR-0069 decision 4), which the core
 * treats as `stop`; `closed` resolves once every request in flight has been
 * answered.
 */

export type RequestId = string | number;

export interface ControlRequest {
  id: RequestId;
  type: string;
  [field: string]: unknown;
}

/** The answer to one request: an HTTP status and a JSON body, as a route would give. */
export interface Answer {
  status: number;
  body: unknown;
}

export interface ControlReply extends Answer {
  /** The request's `id`; null when the line could not be read as a request. */
  id: RequestId | null;
}

export interface ControlEvent {
  event: string;
  [field: string]: unknown;
}

export interface HandlerContext {
  /** Sends an event now, ahead of this request's reply. */
  emit: (event: ControlEvent) => void;
}

export type Handler = (request: ControlRequest, context: HandlerContext) => Promise<Answer>;

export interface ChannelOptions {
  input: Readable;
  output: Writable;
  /** The handler for a request's `type`; undefined answers 400 `unknown_request`. */
  handlerFor: (type: string) => Handler | undefined;
}

export interface Channel {
  /** Sends an event that belongs to no request (a log line, a rotated credential, the hub's state). */
  emit: (event: ControlEvent) => void;
  /** Resolves once the input has ended and every request in flight has been answered. */
  closed: Promise<void>;
}

/** A successful answer. */
export const ok = (body: unknown, status = 200): Answer => ({ status, body });

/**
 * An error as a route would answer it: an `ApiError` as `app.onError`
 * renders it; anything else a 500 `internal_error`. Unlike the hub, which
 * keeps a 500's detail in its log, the message goes in the body: the only
 * reader is the program's own shell, which shows it in the log screen.
 */
export function answerOf(err: unknown): Answer {
  if (err instanceof ApiError) return { status: err.status, body: { error: err.code, message: err.message, ...err.details } };
  return { status: 500, body: { error: 'internal_error', message: err instanceof Error ? err.message : String(err) } };
}

/** A response from `app.request()` as an answer: its status and its JSON body, or the text when it is not JSON. */
export async function answerFromResponse(res: Response): Promise<Answer> {
  const text = await res.text();
  if (!text) return { status: res.status, body: null };
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

const isRequestId = (value: unknown): value is RequestId => (typeof value === 'string' && value !== '') || (typeof value === 'number' && Number.isFinite(value));

/** A line as a request, or the answer refusing it. */
function parse(line: string): { request: ControlRequest } | { refused: ControlReply } {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { refused: { id: null, status: 400, body: { error: 'bad_request', message: 'A request is one JSON object on one line' } } };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { refused: { id: null, status: 400, body: { error: 'bad_request', message: 'A request is a JSON object' } } };
  }
  const { id, type } = value as Record<string, unknown>;
  if (!isRequestId(id)) {
    return { refused: { id: null, status: 400, body: { error: 'bad_request', message: 'A request carries an id, a non-empty string or a number, which its reply repeats' } } };
  }
  if (typeof type !== 'string' || !type) {
    return { refused: { id, status: 400, body: { error: 'bad_request', message: 'A request carries a type naming what it asks' } } };
  }
  return { request: value as ControlRequest };
}

/** Opens the channel over a pair of streams and answers each request as its handler does. */
export function openChannel({ input, output, handlerFor }: ChannelOptions): Channel {
  // Each message is written whole, as one line, so a reply and an event never interleave.
  const send = (message: ControlReply | ControlEvent) => {
    output.write(`${JSON.stringify(message)}\n`);
  };
  // A shell gone mid-reply leaves a pipe with no reader, and the write fails with EPIPE as an
  // 'error' event, which unhandled would end the core before it releases the folder's lock.
  // Nothing can be told to a reader that is gone; the input's end follows, and with it the stop.
  output.on('error', () => undefined);
  const inFlight = new Set<Promise<void>>();

  const answer = async (request: ControlRequest): Promise<void> => {
    const handler = handlerFor(request.type);
    let result: Answer;
    if (!handler) {
      result = { status: 400, body: { error: 'unknown_request', message: `The core answers no request of type ${request.type}` } };
    } else {
      try {
        result = await handler(request, { emit: send });
      } catch (err) {
        result = answerOf(err);
      }
    }
    send({ id: request.id, ...result });
  };

  const lines = createInterface({ input, crlfDelay: Infinity });
  lines.on('line', (raw) => {
    const line = raw.trim();
    if (!line) return;
    const parsed = parse(line);
    if ('refused' in parsed) {
      send(parsed.refused);
      return;
    }
    const work = answer(parsed.request);
    inFlight.add(work);
    void work.finally(() => inFlight.delete(work));
  });

  const closed = new Promise<void>((resolve) => {
    lines.once('close', () => {
      void Promise.allSettled([...inFlight]).then(() => resolve());
    });
  });

  return { emit: send, closed };
}
