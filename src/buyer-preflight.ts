import { decodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { createPublicClient, erc20Abi, http } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { loadBuyerEnv } from "./buyer-env.js";
import {
  extractBuyerErrorDiagnostic,
  paymentPayloadPrerequisites,
  type SafeBuyerDiagnostic,
} from "./buyer-diagnostics.js";
import {
  BASE_SEPOLIA,
  BASE_SEPOLIA_USDC_ASSET,
  BUYER_FETCH_REDIRECT,
  createBaseSepoliaPaymentPolicy,
  evaluateBuyerGuards,
  matchesBaseSepoliaPaymentTerms,
  parseBoolFlag,
  selectBaseSepoliaPaymentRequirement,
} from "./buyer-guards.js";

export type PreflightStageStatus = "PASS" | "FAIL" | "SKIP" | "NOT_ATTEMPTED";

export type PreflightStageResult = {
  stage: string;
  status: PreflightStageStatus;
  detail?: string;
  diagnostic?: SafeBuyerDiagnostic;
};

export type BuyerPreflightOptions = {
  fetchImpl?: typeof fetch;
  rpcUrl?: string;
  loadEnv?: boolean;
  publicClient?: {
    getChainId: () => Promise<number>;
    readContract: (args: {
      functionName: string;
      args?: readonly unknown[];
    }) => Promise<unknown>;
  };
};

export type BuyerPreflightReport = {
  mode: "buyer_preflight";
  overall: "PASS" | "FAIL";
  hardStop: true;
  liveSigningAttempted: false;
  paidRequestAttempted: false;
  settlementAttempted: false;
  stages: PreflightStageResult[];
};

const BASE_SEPOLIA_CHAIN_ID = 84532;
const MIN_PAYMENT_UNITS = 1000n;
const TEST_USDC_DECIMALS = 6;

function stageResult(
  stage: string,
  status: PreflightStageStatus,
  detail?: string,
  diagnostic?: SafeBuyerDiagnostic,
): PreflightStageResult {
  return diagnostic ? { stage, status, detail, diagnostic } : { stage, status, detail };
}

function redactionContextFromEnv(): {
  privateKey?: string;
  sellerAddress?: string;
} {
  return {
    privateKey: process.env.EVM_PRIVATE_KEY,
    sellerAddress: process.env.EXPECTED_PAY_TO_ADDRESS,
  };
}

function decodePaymentRequiredHeaderSafe(
  headerValue: string,
): PaymentRequirements[] {
  const decoded = decodePaymentRequiredHeader(headerValue) as PaymentRequired;
  return decoded.accepts;
}

export async function runBuyerPreflight(
  options: BuyerPreflightOptions = {},
): Promise<BuyerPreflightReport> {
  const stages: PreflightStageResult[] = [];
  const fetchImpl = options.fetchImpl ?? fetch;
  const rpcUrl = options.rpcUrl ?? "https://sepolia.base.org";
  const redaction = redactionContextFromEnv();

  if (options.loadEnv !== false) {
    loadBuyerEnv();
  }

  const apiUrl = process.env.API_URL;
  const evmPrivateKey = process.env.EVM_PRIVATE_KEY;
  const expectedPayToAddress = process.env.EXPECTED_PAY_TO_ADDRESS;
  const allowTestnetPayment = parseBoolFlag(process.env.ALLOW_TESTNET_PAYMENT);
  const network = (process.env.X402_NETWORK ?? BASE_SEPOLIA).trim();
  const expectedRemoteApiOrigin = process.env.EXPECTED_REMOTE_API_ORIGIN;

  const guard = evaluateBuyerGuards({
    apiUrl,
    evmPrivateKey,
    allowTestnetPayment,
    expectedPayToAddress,
    network,
    expectedRemoteApiOrigin,
  });

  stages.push(
    stageResult(
      "environment_validation",
      guard.ok ? "PASS" : "FAIL",
      guard.ok ? undefined : guard.reason,
    ),
  );
  if (!guard.ok) {
    return finalizePreflight(stages);
  }

  stages.push(stageResult("api_url_guard", "PASS"));
  stages.push(stageResult("remote_origin_guard", "PASS"));

  let unpaidStatus = 0;
  let paymentHeader: string | null = null;
  try {
    const response = await fetchImpl(apiUrl!, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: BUYER_FETCH_REDIRECT,
    });
    unpaidStatus = response.status;
    paymentHeader =
      response.headers.get("payment-required") ??
      response.headers.get("PAYMENT-REQUIRED");
  } catch (error) {
    stages.push(
      stageResult(
        "unpaid_http_request",
        "FAIL",
        "Unpaid request failed before a response was received.",
        extractBuyerErrorDiagnostic(error, "initial_unpaid_request", redaction),
      ),
    );
    return finalizePreflight(stages);
  }

  stages.push(
    stageResult(
      "unpaid_http_request",
      unpaidStatus === 402 ? "PASS" : "FAIL",
      unpaidStatus === 402 ? undefined : `Expected HTTP 402, received ${unpaidStatus}.`,
    ),
  );
  if (unpaidStatus !== 402 || !paymentHeader) {
    stages.push(
      stageResult(
        "payment_term_validation",
        "FAIL",
        paymentHeader
          ? "Missing payment-required header on unpaid response."
          : "Unable to validate payment terms without payment-required header.",
      ),
    );
    return finalizePreflight(stages);
  }

  let requirements: PaymentRequirements[] = [];
  try {
    requirements = decodePaymentRequiredHeaderSafe(paymentHeader);
  } catch (error) {
    stages.push(
      stageResult(
        "payment_term_validation",
        "FAIL",
        "Could not decode payment-required header.",
        extractBuyerErrorDiagnostic(error, "decode_payment_requirements", redaction),
      ),
    );
    return finalizePreflight(stages);
  }

  const expectedPayTo = expectedPayToAddress!.trim();
  const matching = requirements.filter((requirement) =>
    matchesBaseSepoliaPaymentTerms(requirement, expectedPayTo),
  );
  const paymentTermsOk =
    matching.length === 1 &&
    requirements.length === 1 &&
    matching.every((requirement) =>
      matchesBaseSepoliaPaymentTerms(requirement, expectedPayTo),
    );

  stages.push(
    stageResult(
      "payment_term_validation",
      paymentTermsOk ? "PASS" : "FAIL",
      paymentTermsOk
        ? undefined
        : "Expected exactly one acceptable Base Sepolia payment option.",
    ),
  );

  const prerequisite = matching[0]
    ? paymentPayloadPrerequisites(matching[0])
    : {
        ok: false as const,
        reason: "No acceptable payment requirement available for prerequisite check.",
      };

  stages.push(
    stageResult(
      "payment_payload_prerequisites",
      prerequisite.ok ? "PASS" : "FAIL",
      prerequisite.ok ? undefined : prerequisite.reason,
    ),
  );

  let account;
  try {
    account = privateKeyToAccount(evmPrivateKey!.trim() as `0x${string}`);
    stages.push(stageResult("local_account_construction", "PASS"));
  } catch (error) {
    stages.push(
      stageResult(
        "local_account_construction",
        "FAIL",
        "Could not construct local buyer account.",
        extractBuyerErrorDiagnostic(error, "construct_account", redaction),
      ),
    );
    return finalizePreflight(stages);
  }

  const publicClient =
    options.publicClient ??
    createPublicClient({
      chain: baseSepolia,
      transport: http(rpcUrl),
    });

  let chainId: number | undefined;
  try {
    chainId = await publicClient.getChainId();
    stages.push(
      stageResult(
        "base_sepolia_rpc_connection",
        "PASS",
        undefined,
      ),
    );
    stages.push(
      stageResult(
        "chain_id_verification",
        chainId === BASE_SEPOLIA_CHAIN_ID ? "PASS" : "FAIL",
        chainId === BASE_SEPOLIA_CHAIN_ID
          ? undefined
          : `Expected chain ID ${BASE_SEPOLIA_CHAIN_ID}, received ${chainId}.`,
      ),
    );
  } catch (error) {
    stages.push(
      stageResult(
        "base_sepolia_rpc_connection",
        "FAIL",
        "Base Sepolia RPC connection failed.",
        extractBuyerErrorDiagnostic(error, "construct_account", redaction),
      ),
    );
    stages.push(stageResult("chain_id_verification", "SKIP"));
    return finalizePreflight(stages);
  }

  let decimals = TEST_USDC_DECIMALS;
  try {
    decimals = (await publicClient.readContract({
      address: BASE_SEPOLIA_USDC_ASSET,
      abi: erc20Abi,
      functionName: "decimals",
    })) as number;
    stages.push(stageResult("test_usdc_metadata_query", "PASS"));
  } catch (error) {
    stages.push(
      stageResult(
        "test_usdc_metadata_query",
        "FAIL",
        "Could not query test-USDC metadata.",
        extractBuyerErrorDiagnostic(error, "construct_account", redaction),
      ),
    );
    stages.push(stageResult("buyer_balance_sufficient", "SKIP"));
    return finalizePreflight(stages);
  }

  try {
    const balance = (await publicClient.readContract({
      address: BASE_SEPOLIA_USDC_ASSET,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    })) as bigint;
    const minimumUnits =
      decimals >= TEST_USDC_DECIMALS
        ? MIN_PAYMENT_UNITS
        : MIN_PAYMENT_UNITS * 10n ** BigInt(TEST_USDC_DECIMALS - decimals);
    stages.push(
      stageResult(
        "buyer_balance_sufficient",
        balance >= minimumUnits ? "PASS" : "FAIL",
        balance >= minimumUnits
          ? undefined
          : "Buyer test-USDC balance is below 0.001.",
      ),
    );
  } catch (error) {
    stages.push(
      stageResult(
        "buyer_balance_sufficient",
        "FAIL",
        "Could not query buyer test-USDC balance.",
        extractBuyerErrorDiagnostic(error, "construct_account", redaction),
      ),
    );
  }

  try {
    const client = new x402Client(selectBaseSepoliaPaymentRequirement);
    client.register(BASE_SEPOLIA, new ExactEvmScheme(account));
    client.registerPolicy(createBaseSepoliaPaymentPolicy(expectedPayTo as `0x${string}`));
    const httpClient = new x402HTTPClient(client);
    wrapFetchWithPayment(
      async () => new Response(null, { status: 500 }),
      httpClient,
    );
    stages.push(stageResult("x402_client_construction", "PASS"));
  } catch (error) {
    stages.push(
      stageResult(
        "x402_client_construction",
        "FAIL",
        "Could not construct x402 client and wrapped fetch.",
        extractBuyerErrorDiagnostic(error, "construct_x402_client", redaction),
      ),
    );
  }

  stages.push(stageResult("facilitator_read_only_check", "SKIP", "No read-only facilitator capability endpoint is required by the installed buyer SDK."));
  stages.push(stageResult("live_signing", "NOT_ATTEMPTED"));
  stages.push(stageResult("paid_request", "NOT_ATTEMPTED"));
  stages.push(stageResult("settlement", "NOT_ATTEMPTED"));

  return finalizePreflight(stages);
}

function finalizePreflight(stages: PreflightStageResult[]): BuyerPreflightReport {
  const overall = stages.some((entry) => entry.status === "FAIL") ? "FAIL" : "PASS";
  return {
    mode: "buyer_preflight",
    overall,
    hardStop: true,
    liveSigningAttempted: false,
    paidRequestAttempted: false,
    settlementAttempted: false,
    stages,
  };
}
