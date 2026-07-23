import {
  wrapFetchWithPayment,
  x402Client,
  x402HTTPClient,
  decodePaymentResponseHeader,
} from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { loadBuyerEnv } from "./buyer-env.js";
import {
  buildBuyerErrorReport,
  extractBuyerErrorDiagnostic,
  inferStageFromError,
  sanitizeSettlement,
  sanitizeSuccessPayload,
  type BuyerStage,
  type RedactionContext,
} from "./buyer-diagnostics.js";
import {
  BASE_SEPOLIA,
  BUYER_FETCH_REDIRECT,
  createBaseSepoliaPaymentPolicy,
  evaluateBuyerGuards,
  parseBoolFlag,
  selectBaseSepoliaPaymentRequirement,
} from "./buyer-guards.js";

export type BuyerRunOptions = {
  fetchImpl?: typeof fetch;
  loadEnv?: boolean;
};

export type BuyerRunResult =
  | {
      ok: true;
      status: number;
      body: unknown;
      settlement: unknown;
      network: string;
    }
  | {
      ok: false;
      report: ReturnType<typeof buildBuyerErrorReport>;
    };

export async function runBuyerPayment(
  options: BuyerRunOptions = {},
): Promise<BuyerRunResult> {
  let stage: BuyerStage = "load_environment";
  let redaction: RedactionContext = {};

  try {
    if (options.loadEnv !== false) {
      loadBuyerEnv();
    }
    stage = "validate_guards";

    const apiUrl = process.env.API_URL;
    const evmPrivateKey = process.env.EVM_PRIVATE_KEY;
    const expectedPayToAddress = process.env.EXPECTED_PAY_TO_ADDRESS;
    const allowTestnetPayment = parseBoolFlag(process.env.ALLOW_TESTNET_PAYMENT);
    const network = (process.env.X402_NETWORK ?? BASE_SEPOLIA).trim();
    const expectedRemoteApiOrigin = process.env.EXPECTED_REMOTE_API_ORIGIN;

    redaction = {
      privateKey: evmPrivateKey,
      sellerAddress: expectedPayToAddress,
      envValues: {
        EVM_PRIVATE_KEY: evmPrivateKey,
        EXPECTED_PAY_TO_ADDRESS: expectedPayToAddress,
        API_URL: apiUrl,
        EXPECTED_REMOTE_API_ORIGIN: expectedRemoteApiOrigin,
      },
    };

    const guard = evaluateBuyerGuards({
      apiUrl,
      evmPrivateKey,
      allowTestnetPayment,
      expectedPayToAddress,
      network,
      expectedRemoteApiOrigin,
    });

    if (!guard.ok) {
      throw new Error(guard.reason);
    }

    stage = "construct_account";
    const expectedPayTo = expectedPayToAddress!.trim() as `0x${string}`;
    const account = privateKeyToAccount(
      evmPrivateKey!.trim() as `0x${string}`,
    );
    redaction.buyerAddress = account.address;

    stage = "construct_x402_client";
    const client = new x402Client(selectBaseSepoliaPaymentRequirement);
    client.register(BASE_SEPOLIA, new ExactEvmScheme(account));
    client.registerPolicy(createBaseSepoliaPaymentPolicy(expectedPayTo));

    const httpClient = new x402HTTPClient(client);

    stage = "construct_wrapped_fetch";
    let fetchCallCount = 0;
    const baseFetch = options.fetchImpl ?? fetch;
    const instrumentedFetch: typeof fetch = async (input, init) => {
      fetchCallCount += 1;
      if (fetchCallCount === 1) {
        stage = "initial_unpaid_request";
      } else {
        stage = "submit_paid_request";
      }
      return baseFetch(input, init);
    };

    const fetchWithPayment = wrapFetchWithPayment(instrumentedFetch, httpClient);

    stage = "initial_unpaid_request";
    const response = await fetchWithPayment(apiUrl!, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: BUYER_FETCH_REDIRECT,
    });

    stage = "read_resource_response";
    const bodyText = await response.text();
    let bodyJson: unknown = bodyText;
    try {
      bodyJson = JSON.parse(bodyText);
    } catch {
      // keep text
    }

    stage = "decode_settlement_response";
    let settlement: unknown = undefined;
    const paymentResponseHeader =
      response.headers.get("payment-response") ??
      response.headers.get("PAYMENT-RESPONSE");
    if (paymentResponseHeader) {
      try {
        settlement = sanitizeSettlement(
          decodePaymentResponseHeader(paymentResponseHeader),
        );
      } catch {
        settlement = {
          note: "payment-response present but could not be decoded",
        };
      }
    }

    stage = "emit_success_output";
    return {
      ok: true,
      status: response.status,
      body: bodyJson,
      settlement,
      network: BASE_SEPOLIA,
    };
  } catch (error) {
    const inferredStage = inferStageFromError(error, stage);
    return {
      ok: false,
      report: buildBuyerErrorReport(error, inferredStage, redaction),
    };
  }
}

export function formatBuyerSuccessOutput(
  result: Extract<BuyerRunResult, { ok: true }>,
  redaction: RedactionContext,
): Record<string, unknown> {
  return sanitizeSuccessPayload(
    {
      status: result.status,
      body: result.body,
      settlement: result.settlement,
      payer: "[REDACTED]",
      network: result.network,
    },
    redaction,
  );
}

export function formatBuyerFailureOutput(
  result: Extract<BuyerRunResult, { ok: false }>,
): Record<string, unknown> {
  return result.report;
}

export { extractBuyerErrorDiagnostic };
