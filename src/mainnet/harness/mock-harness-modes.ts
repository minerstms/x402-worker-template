import type {
  MockSettleMode,
  MockVerifyMode,
} from "./mock-facilitator-client.js";

export type MockHarnessSimulationMode =
  | "normal-success"
  | "response-loss"
  | "verify-delayed"
  | "settle-delayed"
  | "verify-definitive-failure"
  | "settle-definitive-failure"
  | "verify-timeout"
  | "settle-timeout"
  | "malformed-settlement";

export function mapHarnessModeToFacilitatorModes(mode: MockHarnessSimulationMode): {
  verifyMode: MockVerifyMode;
  settleMode: MockSettleMode;
} {
  switch (mode) {
    case "verify-delayed":
      return { verifyMode: { delayMs: 1500 }, settleMode: "success" };
    case "settle-delayed":
      return { verifyMode: "success", settleMode: { delayMs: 1500 } };
    case "verify-definitive-failure":
      return { verifyMode: "definitive_failure", settleMode: "success" };
    case "settle-definitive-failure":
      return { verifyMode: "success", settleMode: "definitive_failure" };
    case "verify-timeout":
      return { verifyMode: "throw_timeout", settleMode: "success" };
    case "settle-timeout":
      return { verifyMode: "success", settleMode: "throw_timeout" };
    case "malformed-settlement":
      return { verifyMode: "success", settleMode: "malformed_response" };
    case "response-loss":
    case "normal-success":
    default:
      return { verifyMode: "success", settleMode: "success" };
  }
}
