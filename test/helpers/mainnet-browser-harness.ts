import { decodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentPayload } from "@x402/core/types";
import { buildSafePaymentStatusBody } from "../../src/mainnet/routes/pay-status.js";
import { coordinatorGetStatusByPaymentIdentifier } from "../../src/mainnet/durable/payment-coordinator-client.js";
import {
  dispatchMainnetOrchestratorRequest,
  dispatchMainnetPaidRequest,
  dispatchMainnetUnpaidRequest,
} from "./mainnet-orchestrator-harness.js";
import {
  createMainnetOrchestratorContext,
  buildMainnetExampleRequestUrl,
  MAINNET_TEST_QUERY_VALUE,
} from "./mainnet-orchestrator-harness.js";

export async function createMainnetBrowserFetchHarness(
  options: Parameters<typeof createMainnetOrchestratorContext>[0] = {},
) {
  const context = await createMainnetOrchestratorContext(options);
  const { deps } = context;

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.startsWith("/pay/status/")) {
      const paymentIdentifier = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      const snapshot = await coordinatorGetStatusByPaymentIdentifier(
        deps.coordinator,
        paymentIdentifier,
      );
      const body = buildSafePaymentStatusBody(snapshot);
      const status = snapshot ? 200 : 404;
      return new Response(JSON.stringify(body), {
        status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    }

    if (url.pathname === "/v1/example") {
      const headers = new Headers(init?.headers ?? {});
      const paymentSignatureHeader =
        headers.get("payment-signature") ?? headers.get("PAYMENT-SIGNATURE");
      if (paymentSignatureHeader) {
        return dispatchMainnetOrchestratorRequest(deps, {
          url,
          paymentSignatureHeader,
        });
      }
      return dispatchMainnetUnpaidRequest(deps, url);
    }

    throw new Error(`Unexpected fetch in mainnet browser harness: ${url.toString()}`);
  };

  return {
    ...context,
    fetchImpl,
    origin: "http://localhost",
    async paidRequest(payload: PaymentPayload, value = MAINNET_TEST_QUERY_VALUE) {
      return dispatchMainnetPaidRequest(
        deps,
        payload,
        buildMainnetExampleRequestUrl(value),
      );
    },
    async unpaidRequest(value = MAINNET_TEST_QUERY_VALUE) {
      const response = await dispatchMainnetUnpaidRequest(
        deps,
        buildMainnetExampleRequestUrl(value),
      );
      return {
        response,
        paymentRequiredHeader:
          response.headers.get("payment-required") ??
          response.headers.get("PAYMENT-REQUIRED"),
      };
    },
  };
}

export function createMemorySessionStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

export function decodeUnpaidPaymentRequired(response: Response) {
  const header =
    response.headers.get("payment-required") ??
    response.headers.get("PAYMENT-REQUIRED");
  if (!header) {
    throw new Error("Missing payment-required header");
  }
  return decodePaymentRequiredHeader(header);
}
