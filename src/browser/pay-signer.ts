import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import type { PaymentPolicy } from "@x402/core/client";
import { createWalletClient, custom, type Address } from "viem";

type BrowserEip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};
import { baseSepolia } from "viem/chains";
import {
  BASE_SEPOLIA,
  createBaseSepoliaPaymentPolicy,
  selectBaseSepoliaPaymentRequirement,
} from "../payment-policy.js";

export type BrowserPaymentClients = {
  client: x402Client;
  httpClient: x402HTTPClient;
  walletClient: ReturnType<typeof createWalletClient>;
};

export function createBrowserPaymentClients(options: {
  provider: BrowserEip1193Provider;
  account: Address;
  expectedSellerAddress: string;
  paymentPolicy?: PaymentPolicy;
}): BrowserPaymentClients {
  const walletClient = createWalletClient({
    account: options.account,
    chain: baseSepolia,
    transport: custom(options.provider),
  });
  const evmSigner = toClientEvmSigner({
    address: options.account,
    signTypedData: (message) =>
      walletClient.signTypedData({
        account: options.account,
        domain: message.domain,
        types: message.types,
        primaryType: message.primaryType,
        message: message.message,
      }),
  });
  const client = new x402Client(selectBaseSepoliaPaymentRequirement);
  client.register(BASE_SEPOLIA, new ExactEvmScheme(evmSigner));
  client.registerPolicy(
    options.paymentPolicy ??
      createBaseSepoliaPaymentPolicy(options.expectedSellerAddress),
  );
  return {
    client,
    httpClient: new x402HTTPClient(client),
    walletClient,
  };
}
