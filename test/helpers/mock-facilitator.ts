export * from "../../src/mainnet/harness/mock-facilitator-client.js";

export function installNetworkGuard(): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
    throw new Error(
      `Unexpected external fetch in mainnet orchestrator tests: ${String(args[0])}`,
    );
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}
