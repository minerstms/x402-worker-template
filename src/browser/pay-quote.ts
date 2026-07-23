import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import type { PayPublicConfig } from "../pay-public-config.js";
import { matchesBaseSepoliaPaymentTerms } from "../payment-policy.js";
import type { PaymentSummary } from "./pay-wallet-state.js";

export type PaymentQuote = {
  quoteId: string;
  paymentRequired: PaymentRequired;
  requirement: PaymentRequirements;
  requestUrl: string;
  queryValue: string;
  account: string;
  chainId: number;
  sellerAddress: string;
  configFingerprint: string;
  consumed: boolean;
  summary: PaymentSummary;
};

export function buildConfigFingerprint(config: PayPublicConfig): string {
  return [
    config.serviceName,
    config.paidRoute,
    config.allowedQueryKey,
    config.atomicAmount,
    config.tokenContract,
    config.caip2Network,
    config.chainId,
    config.eip712Name,
    config.eip712Version,
    config.timeout,
    config.sellerAddress,
    String(config.paymentReady),
  ].join("|");
}

export function buildPaymentSummary(
  publicConfig: PayPublicConfig,
  queryValue: string,
): PaymentSummary {
  return {
    paying: "0.001 test USDC",
    network: publicConfig.networkLabel,
    service: publicConfig.paidRoute,
    input: queryValue,
    sellerStatus: publicConfig.paymentReady ? "verified" : "placeholder",
    tokenStatus: "verified",
    amountStatus: "verified",
    eip712Status: "verified",
    timeoutStatus: "verified",
    optionsCount: 1,
    renewal: "none",
    requestsAuthorized: 0,
  };
}

export function createPaymentQuote(options: {
  paymentRequired: PaymentRequired;
  requirement: PaymentRequirements;
  publicConfig: PayPublicConfig;
  account: string;
  chainId: number;
  requestUrl: string;
  queryValue: string;
  quoteId?: string;
}): PaymentQuote {
  return {
    quoteId: options.quoteId ?? crypto.randomUUID(),
    paymentRequired: options.paymentRequired,
    requirement: options.requirement,
    requestUrl: options.requestUrl,
    queryValue: options.queryValue,
    account: options.account,
    chainId: options.chainId,
    sellerAddress: options.publicConfig.sellerAddress,
    configFingerprint: buildConfigFingerprint(options.publicConfig),
    consumed: false,
    summary: buildPaymentSummary(options.publicConfig, options.queryValue),
  };
}

export type PaymentReadinessInput = {
  publicConfig: PayPublicConfig | null;
  account: string | null;
  chainId: number | null;
  expectedChainId: number;
  quote: PaymentQuote | null;
  pendingAction: string | null;
  attemptStarted: boolean;
  paymentAttemptCompleted: boolean;
};

export function evaluatePaymentReadiness(
  input: PaymentReadinessInput,
): { ready: boolean; reason: string } {
  const config = input.publicConfig;
  if (!config) {
    return { ready: false, reason: "Public payment configuration is unavailable." };
  }
  if (!config.paymentReady || config.sellerIsPlaceholder) {
    return {
      ready: false,
      reason: "Payment remains disabled until a real seller address is configured.",
    };
  }
  if (!input.account) {
    return { ready: false, reason: "Wallet is not connected." };
  }
  if (input.chainId !== input.expectedChainId) {
    return { ready: false, reason: "Wallet is not on Base Sepolia." };
  }
  if (!input.quote) {
    return { ready: false, reason: "Payment terms have not been loaded." };
  }
  if (input.quote.consumed || input.attemptStarted) {
    return { ready: false, reason: "This quote has already been used." };
  }
  if (input.paymentAttemptCompleted) {
    return {
      ready: false,
      reason: "Load fresh payment terms before attempting another payment.",
    };
  }
  if (input.pendingAction !== null) {
    return { ready: false, reason: "Another action is already in progress." };
  }
  if (input.quote.account.toLowerCase() !== input.account.toLowerCase()) {
    return { ready: false, reason: "Loaded terms do not match the connected account." };
  }
  if (input.quote.chainId !== input.chainId) {
    return { ready: false, reason: "Loaded terms do not match the current chain." };
  }
  if (input.quote.configFingerprint !== buildConfigFingerprint(config)) {
    return { ready: false, reason: "Loaded terms do not match the current configuration." };
  }
  if (input.quote.paymentRequired.accepts.length !== 1) {
    return { ready: false, reason: "Expected exactly one payment option." };
  }
  if (
    !matchesBaseSepoliaPaymentTerms(
      input.quote.requirement,
      config.sellerAddress,
    )
  ) {
    return { ready: false, reason: "Loaded terms failed policy validation." };
  }
  return { ready: true, reason: "Ready for one explicit testnet payment attempt." };
}

export type QuoteSigningContext = {
  quote: PaymentQuote;
  account: string;
  chainId: number;
  publicConfig: PayPublicConfig;
};

export function assertQuoteReadyForSigning(
  context: QuoteSigningContext,
): { ok: true } | { ok: false; reason: string } {
  const readiness = evaluatePaymentReadiness({
    publicConfig: context.publicConfig,
    account: context.account,
    chainId: context.chainId,
    expectedChainId: context.publicConfig.chainId,
    quote: context.quote,
    pendingAction: null,
    attemptStarted: false,
    paymentAttemptCompleted: false,
  });
  if (!readiness.ready) {
    return { ok: false, reason: readiness.reason };
  }

  const { quote, account, chainId, publicConfig } = context;
  const requirement = quote.requirement;

  if (quote.consumed) {
    return { ok: false, reason: "This quote has already been consumed." };
  }
  if (quote.requestUrl.trim().length === 0) {
    return { ok: false, reason: "Quote URL is missing." };
  }
  if (quote.account.toLowerCase() !== account.toLowerCase()) {
    return { ok: false, reason: "Connected account changed since terms were loaded." };
  }
  if (quote.chainId !== chainId) {
    return { ok: false, reason: "Connected chain changed since terms were loaded." };
  }
  if (quote.sellerAddress.toLowerCase() !== publicConfig.sellerAddress.toLowerCase()) {
    return { ok: false, reason: "Seller address changed since terms were loaded." };
  }
  if (requirement.amount !== publicConfig.atomicAmount) {
    return { ok: false, reason: "Payment amount changed since terms were loaded." };
  }
  if (
    requirement.asset.toLowerCase() !== publicConfig.tokenContract.toLowerCase()
  ) {
    return { ok: false, reason: "Payment token changed since terms were loaded." };
  }
  if (requirement.maxTimeoutSeconds !== publicConfig.timeout) {
    return { ok: false, reason: "Payment timeout changed since terms were loaded." };
  }
  if (requirement.extra?.name !== publicConfig.eip712Name) {
    return { ok: false, reason: "EIP-712 domain name changed since terms were loaded." };
  }
  if (requirement.extra?.version !== publicConfig.eip712Version) {
    return {
      ok: false,
      reason: "EIP-712 domain version changed since terms were loaded.",
    };
  }
  if (quote.paymentRequired.accepts.length !== 1) {
    return { ok: false, reason: "Expected exactly one payment option." };
  }
  if (!matchesBaseSepoliaPaymentTerms(requirement, publicConfig.sellerAddress)) {
    return { ok: false, reason: "Payment terms no longer match policy." };
  }

  return { ok: true };
}

export function invalidateQuote(
  quote: PaymentQuote | null,
): PaymentQuote | null {
  return quote ? null : null;
}

export function markQuoteConsumed(quote: PaymentQuote): PaymentQuote {
  return { ...quote, consumed: true };
}
