/**
 * Browser fetch with a preserved Window/globalThis receiver.
 * Assigning bare `fetch` and calling it later throws "Illegal invocation".
 */
export const browserFetch: typeof fetch = (input, init) =>
  globalThis.fetch(input, init);
