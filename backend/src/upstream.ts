import { config } from "./config.js";
import { getLogger, scrubSecrets } from "./logger.js";

const log = getLogger("upstream");

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

/** Responses worth trying once more: transient network faults and provider throttling. */
function retryable(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/**
 * Fetch JSON from a provider with a timeout and a single retry.
 *
 * Upstream URLs can carry API keys, so failures are logged through the scrubber and the
 * message handed back to callers never includes the URL.
 */
export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  label = "upstream",
): Promise<T> {
  let lastError: UpstreamError | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.upstreamTimeoutMs);
    const started = Date.now();
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: { Accept: "application/json", "User-Agent": "wally-backend/0.1", ...(init.headers ?? {}) },
      });

      if (!response.ok) {
        const error = new UpstreamError(
          `${label} responded ${response.status}`,
          response.status,
          retryable(response.status),
        );
        // Log before throwing: a caller that answers 503 without this leaves no trace of why.
        if (!error.retryable || attempt === 1) {
          log.warn({ label, status: response.status, attempt }, "upstream rejected the request");
          throw error;
        }
        lastError = error;
        log.warn({ label, status: response.status, attempt }, "retrying upstream");
        continue;
      }

      const body = (await response.json()) as T;
      log.debug({ label, ms: Date.now() - started }, "upstream ok");
      return body;
    } catch (error) {
      if (error instanceof UpstreamError) {
        if (!error.retryable || attempt === 1) throw error;
        lastError = error;
        continue;
      }
      const aborted = error instanceof Error && error.name === "AbortError";
      const wrapped = new UpstreamError(
        aborted ? `${label} timed out after ${config.upstreamTimeoutMs}ms` : `${label} is unreachable`,
        504,
        true,
      );
      if (attempt === 1) {
        log.warn({ label, timedOut: aborted, err: scrubSecrets(String(error)) }, "upstream failed");
        throw wrapped;
      }
      lastError = wrapped;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new UpstreamError(`${label} failed`, 502, false);
}
