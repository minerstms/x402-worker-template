/**
 * Read-only buyer preflight diagnostics. Does not sign or submit payment.
 */
import { runBuyerPreflight } from "../src/buyer-preflight.js";

async function main(): Promise<void> {
  const report = await runBuyerPreflight();
  console.log(JSON.stringify(report, null, 2));
  if (report.overall !== "PASS") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        mode: "buyer_preflight",
        overall: "FAIL",
        hardStop: true,
        message:
          error instanceof Error
            ? error.message.slice(0, 240)
            : "Preflight command failed unexpectedly.",
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
