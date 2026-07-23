import {
  BASE_SEPOLIA_MAX_TIMEOUT_SECONDS,
  BASE_SEPOLIA_PAYMENT_AMOUNT,
  BASE_SEPOLIA_USDC_ASSET,
  BASE_SEPOLIA_USDC_EIP712_NAME,
  BASE_SEPOLIA_USDC_EIP712_VERSION,
  isDeadPayToAddress,
  type ResolvedConfig,
} from "./config.js";

export const PAID_ROUTE = "/v1/example";
export const ALLOWED_QUERY_KEY = "value";
export const BROWSER_DEMO_QUERY_VALUE = "browser-demo";
export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const ENVIRONMENT_LABEL = "BASE SEPOLIA TESTNET";
export const TOKEN_SYMBOL = "test USDC";
export const NETWORK_LABEL = "Base Sepolia testnet";

export type PayPublicConfig = {
  serviceName: string;
  paidRoute: string;
  allowedQueryKey: string;
  priceDisplay: string;
  atomicAmount: string;
  tokenSymbol: string;
  tokenContract: string;
  networkLabel: string;
  caip2Network: string;
  chainId: number;
  eip712Name: string;
  eip712Version: string;
  timeout: number;
  sellerAddress: string;
  sellerIsPlaceholder: boolean;
  paymentReady: boolean;
  environmentLabel: string;
};

export const PAY_PUBLIC_CONFIG_FIELDS = [
  "serviceName",
  "paidRoute",
  "allowedQueryKey",
  "priceDisplay",
  "atomicAmount",
  "tokenSymbol",
  "tokenContract",
  "networkLabel",
  "caip2Network",
  "chainId",
  "eip712Name",
  "eip712Version",
  "timeout",
  "sellerAddress",
  "sellerIsPlaceholder",
  "paymentReady",
  "environmentLabel",
] as const satisfies readonly (keyof PayPublicConfig)[];

export function buildPayPublicConfig(config: ResolvedConfig): PayPublicConfig {
  const sellerIsPlaceholder = isDeadPayToAddress(config.payToAddress);
  return {
    serviceName: config.serviceName,
    paidRoute: PAID_ROUTE,
    allowedQueryKey: ALLOWED_QUERY_KEY,
    priceDisplay: config.priceAccept,
    atomicAmount: BASE_SEPOLIA_PAYMENT_AMOUNT,
    tokenSymbol: TOKEN_SYMBOL,
    tokenContract: BASE_SEPOLIA_USDC_ASSET,
    networkLabel: NETWORK_LABEL,
    caip2Network: config.network,
    chainId: BASE_SEPOLIA_CHAIN_ID,
    eip712Name: BASE_SEPOLIA_USDC_EIP712_NAME,
    eip712Version: BASE_SEPOLIA_USDC_EIP712_VERSION,
    timeout: BASE_SEPOLIA_MAX_TIMEOUT_SECONDS,
    sellerAddress: config.payToAddress,
    sellerIsPlaceholder,
    paymentReady: !sellerIsPlaceholder,
    environmentLabel: ENVIRONMENT_LABEL,
  };
}

export function buildPaidExampleUrl(
  origin: string,
  queryValue: string = BROWSER_DEMO_QUERY_VALUE,
): string {
  const url = new URL(PAID_ROUTE, origin);
  url.searchParams.set(ALLOWED_QUERY_KEY, queryValue);
  return url.toString();
}
