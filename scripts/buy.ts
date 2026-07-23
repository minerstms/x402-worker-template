/**
 * Fetch-based x402 buyer client for local supervised payments.
 *
 * Phase 1: Base Sepolia only. Do NOT run until a supervised Red-lane step.
 */
import {
  formatBuyerFailureOutput,
  formatBuyerSuccessOutput,
  runBuyerPayment,
} from "../src/buyer-run.js";

async function main(): Promise<void> {
  const result = await runBuyerPayment();

  if (!result.ok) {
    console.error(JSON.stringify(formatBuyerFailureOutput(result), null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify(
      formatBuyerSuccessOutput(result, {
        envValues: {
          EVM_PRIVATE_KEY: process.env.EVM_PRIVATE_KEY,
          EXPECTED_PAY_TO_ADDRESS: process.env.EXPECTED_PAY_TO_ADDRESS,
          API_URL: process.env.API_URL,
          EXPECTED_REMOTE_API_ORIGIN: process.env.EXPECTED_REMOTE_API_ORIGIN,
        },
      }),
      null,
      2,
    ),
  );
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("buy.ts") || process.argv[1].endsWith("buy.js"));

if (invokedDirectly) {
  main().catch((error) => {
    console.error(
      JSON.stringify(
        {
          level: "error",
          message: "Buyer script failed. Check configuration and try again.",
          diagnostic: {
            stage: "emit_success_output",
            message:
              error instanceof Error
                ? error.message.slice(0, 240)
                : "Unhandled buyer script failure",
          },
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  });
}

export { main };
