export type AppEnv = {
  X402_NETWORK: string;
  X402_PRICE_USD: string;
  X402_FACILITATOR_URL: string;
  X402_PAY_TO_ADDRESS: string;
};

export type ResolvedConfig = {
  network: string;
  priceUsd: string;
  priceAccept: string;
  facilitatorUrl: string;
  payToAddress: `0x${string}`;
  serviceName: string;
};

export const SERVICE_NAME = "x402 Paid Worker Template";
export const SERVICE_ID = "x402-worker-template";
export const ALLOWED_SELLER_NETWORK = "eip155:84532";
export const DEFAULT_NETWORK = ALLOWED_SELLER_NETWORK;
export const DEFAULT_PRICE_USD = "0.001";
export const BASE_SEPOLIA_USDC_ASSET =
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
/** EIP-712 domain name for Base Sepolia test USDC (contract `name()`). */
export const BASE_SEPOLIA_USDC_EIP712_NAME = "USDC";
/** EIP-712 domain version for Base Sepolia test USDC (contract `version()`). */
export const BASE_SEPOLIA_USDC_EIP712_VERSION = "2";
export const BASE_SEPOLIA_PAYMENT_AMOUNT = "1000";
export const BASE_SEPOLIA_MAX_TIMEOUT_SECONDS = 300;
export const DEFAULT_FACILITATOR_URL = "https://x402.org/facilitator";
export const DEFAULT_PAY_TO =
  "0x000000000000000000000000000000000000dEaD" as const;

/** Placeholder only — do not attempt payment while this address is configured. */
export const PAY_TO_PLACEHOLDER_WARNING =
  "X402_PAY_TO_ADDRESS is set to the dead address placeholder. Do not attempt payment while it is configured.";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function assertAllowedSellerNetwork(network: string): void {
  if (network !== ALLOWED_SELLER_NETWORK) {
    throw new Error(
      `X402_NETWORK must be ${ALLOWED_SELLER_NETWORK}. Other networks are not permitted.`,
    );
  }
}

export function resolveConfig(env: Partial<AppEnv> = {}): ResolvedConfig {
  const network = (env.X402_NETWORK ?? DEFAULT_NETWORK).trim();
  const priceUsd = (env.X402_PRICE_USD ?? DEFAULT_PRICE_USD).trim();
  const facilitatorUrl = (
    env.X402_FACILITATOR_URL ?? DEFAULT_FACILITATOR_URL
  ).trim();
  const payToAddress = (
    env.X402_PAY_TO_ADDRESS ?? DEFAULT_PAY_TO
  ).trim() as `0x${string}`;

  if (!network) {
    throw new Error("X402_NETWORK is required");
  }
  assertAllowedSellerNetwork(network);
  if (!priceUsd || Number.isNaN(Number(priceUsd)) || Number(priceUsd) <= 0) {
    throw new Error("X402_PRICE_USD must be a positive number string");
  }
  if (!facilitatorUrl) {
    throw new Error("X402_FACILITATOR_URL is required");
  }
  if (!ADDRESS_RE.test(payToAddress)) {
    throw new Error("X402_PAY_TO_ADDRESS must be a 0x-prefixed 40-byte hex address");
  }

  return {
    network,
    priceUsd,
    priceAccept: `$${priceUsd}`,
    facilitatorUrl,
    payToAddress,
    serviceName: SERVICE_NAME,
  };
}

export function isDeadPayToAddress(address: string): boolean {
  return address.toLowerCase() === DEFAULT_PAY_TO.toLowerCase();
}
