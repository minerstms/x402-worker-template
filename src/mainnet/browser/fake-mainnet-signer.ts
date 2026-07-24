import type { TypedDataDomain } from "viem";
import type { ClientEvmSigner } from "@x402/evm";
import { toClientEvmSigner } from "@x402/evm";

export const FAKE_MAINNET_SIGNER_ADDRESS =
  "0x1111111111111111111111111111111111111111" as const;

export const FAKE_MAINNET_SIGNATURE =
  `0x${"11".repeat(65)}` as `0x${string}`;

export type FakeMainnetSignerRecorder = {
  invocationCount: number;
  lastDomain: TypedDataDomain | null;
  lastMessage: Record<string, unknown> | null;
  lastTypes: Record<string, unknown> | null;
  lastPrimaryType: string | null;
};

export type FakeMainnetSigner = ClientEvmSigner & {
  recorder: FakeMainnetSignerRecorder;
};

export function createFakeMainnetSigner(): FakeMainnetSigner {
  const recorder: FakeMainnetSignerRecorder = {
    invocationCount: 0,
    lastDomain: null,
    lastMessage: null,
    lastTypes: null,
    lastPrimaryType: null,
  };

  const signer = toClientEvmSigner({
    address: FAKE_MAINNET_SIGNER_ADDRESS,
    signTypedData: async (message) => {
      recorder.invocationCount += 1;
      recorder.lastDomain = message.domain;
      recorder.lastMessage = message.message as Record<string, unknown>;
      recorder.lastTypes = message.types as Record<string, unknown>;
      recorder.lastPrimaryType = message.primaryType;
      return FAKE_MAINNET_SIGNATURE;
    },
  });

  return Object.assign(signer, { recorder });
}
