/**
 * Read-only buyer preflight diagnostics. Does not sign or submit payment.
 */
import { runBuyerPreflight } from "../src/buyer-preflight.js";
import { formatSafeCliErrorJson } from "../src/cli/safe-cli-error.js";

async function main(): Promise<void> {
  const report = await runBuyerPreflight();
  console.log(JSON.stringify(report, null, 2));
  if (report.overall !== "PASS") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    formatSafeCliErrorJson({
      stage: "buyer_preflight",
      message: "Preflight command failed.",
      error,
      extra: {
        mode: "buyer_preflight",
        overall: "FAIL",
        hardStop: true,
      },
    }),
  );
  process.exitCode = 1;
});
