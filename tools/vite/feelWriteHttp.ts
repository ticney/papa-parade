import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import {
  FEEL_WRITER_HEADER,
  FEEL_WRITER_HEADER_VALUE,
  FEEL_WRITER_MAX_BODY_BYTES,
} from '../../src/shared/constants.ts';
import { type FeelWriteDeps, type FeelWriteResponse, handleFeelWrite } from './feelWrite.ts';

// Imports are relative on purpose: `vite.config.ts` loads this file before the path aliases exist.

/** The request's own checks, before its body is read: a refusal, or `null` when it may go on. */
export function gateFeelRequest(request: {
  method?: string | undefined;
  headers: IncomingHttpHeaders;
}): FeelWriteResponse | null {
  const refuse = (status: number, message: string): FeelWriteResponse => ({
    status,
    body: { ok: false, message },
  });
  const { headers } = request;
  if (request.method !== 'POST') return refuse(405, 'the feel-writer answers POST only');

  // A browser sends `Origin` on every cross-site request and on every `POST`; a tool without a
  // browser (curl, the tests) sends none and is allowed by the header check below. The page
  // that is served from the dev server's own host, whatever that host is (localhost, the
  // LAN address a phone uses), sends its own host, so Geo's phone passes.
  const { origin, host } = headers;
  if (origin !== undefined) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      // `Origin: null` (a sandboxed frame, a file) or garbage: refused just below.
    }
    if (
      originHost === null ||
      host === undefined ||
      originHost.toLowerCase() !== host.toLowerCase()
    ) {
      return refuse(403, 'the feel-writer refuses a request from another origin');
    }
  }

  // `application/json` is not a « simple » content type: a cross-site page cannot send it without
  // a CORS preflight, and the dev server answers none.
  const contentType = (headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    return refuse(415, 'the feel-writer wants Content-Type: application/json');
  }
  if (headers[FEEL_WRITER_HEADER] !== FEEL_WRITER_HEADER_VALUE) {
    return refuse(403, `the feel-writer wants the ${FEEL_WRITER_HEADER} header`);
  }
  return null;
}

export interface FeelWriterMiddlewareOptions {
  /** The deps of one write; called once the request passed every check, and inside the queue. */
  loadDeps(): Promise<FeelWriteDeps>;
  /** Where an unexpected failure goes (the dev server's logger). */
  onError(cause: unknown): void;
}

/**
 * The request handler of the `feel-writer` endpoint, as a plain Node `(request, response)`
 * function (what Connect middleware is), so a throwaway `http.Server` can host it in a test.
 *
 * Order of the answers: method (405), origin (403), content type (415), custom header (403), body
 * size (413, streamed: the connection is closed after the answer), then {@link handleFeelWrite}.
 * The writes themselves run one at a time (a promise chain): two saves never share a read-merge-write
 * window.
 */
export function createFeelWriterMiddleware(
  options: FeelWriterMiddlewareOptions,
): (request: IncomingMessage, response: ServerResponse) => void {
  let queue: Promise<void> = Promise.resolve();

  const send = (response: ServerResponse, answer: FeelWriteResponse): void => {
    if (response.headersSent) return;
    response.statusCode = answer.status;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(answer.body));
  };

  return (request, response) => {
    const refused = gateFeelRequest(request);
    if (refused !== null) {
      // The body is not read: close the connection once the answer is out.
      response.setHeader('Connection', 'close');
      response.once('finish', () => request.destroy());
      send(response, refused);
      return;
    }

    const tooBig: FeelWriteResponse = {
      status: 413,
      body: { ok: false, message: `the request body is over ${FEEL_WRITER_MAX_BODY_BYTES} bytes` },
    };
    const declared = Number(request.headers['content-length']);
    const refuseBig = (): void => {
      response.setHeader('Connection', 'close');
      response.once('finish', () => request.destroy());
      send(response, tooBig);
    };
    if (Number.isFinite(declared) && declared > FEEL_WRITER_MAX_BODY_BYTES) {
      refuseBig();
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    let isDone = false;
    request.on('data', (chunk: Buffer) => {
      if (isDone) return;
      size += chunk.length;
      if (size > FEEL_WRITER_MAX_BODY_BYTES) {
        isDone = true;
        chunks.length = 0;
        refuseBig();
        return;
      }
      chunks.push(chunk);
    });
    request.on('error', (cause) => {
      isDone = true;
      options.onError(cause);
    });
    request.on('end', () => {
      if (isDone) return;
      isDone = true;
      const bodyText = Buffer.concat(chunks).toString('utf8');
      const work = async (): Promise<void> => {
        try {
          const deps = await options.loadDeps();
          send(response, await handleFeelWrite({ method: request.method, bodyText }, deps));
        } catch (cause) {
          options.onError(cause);
          // Once the headers are out the answer is on its way: a second `end()` would throw.
          send(response, { status: 500, body: { ok: false, message: 'the feel-writer failed' } });
        }
      };
      queue = queue.then(work, work);
    });
  };
}
