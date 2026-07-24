export const MAINNET_SAFE_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

export type MainnetSafeResponseHeaders = typeof MAINNET_SAFE_RESPONSE_HEADERS;
