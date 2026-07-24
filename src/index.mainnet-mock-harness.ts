/// <reference path="../worker-configuration.mainnet.d.ts" />

import { Hono } from "hono";
import {
  createMainnetOrchestratorResourceServer,
  handleMainnetExampleRequest,
  type MainnetOrchestratorContext,
  type MainnetOrchestratorDeps,
} from "./mainnet/idempotency/mainnet-payment-orchestrator.js";
import { createMockFacilitatorClient, type MockFacilitatorClient } from "./mainnet/harness/mock-facilitator-client.js";
import { mapHarnessModeToFacilitatorModes, type MockHarnessSimulationMode } from "./mainnet/harness/mock-harness-modes.js";
import { payStatusHandler } from "./mainnet/routes/pay-status.js";
import {
  buildMockPayPageHtml,
  MOCK_PAY_CONTENT_SECURITY_POLICY,
} from "./mainnet/browser/mock-pay-page.js";
import { MOCK_PAY_CSS, MOCK_PAY_JS } from "./generated/mock-pay-assets.js";

export { PaymentCoordinatorDurableObject } from "./mainnet/durable/PaymentCoordinatorDurableObject.js";

const MAINNET_TEST_SELLER = "0x000000000000000000000000000000000000dEaD";

let activeMode: MockHarnessSimulationMode = "normal-success";
const facilitator: MockFacilitatorClient = createMockFacilitatorClient();

function applyHarnessMode(mode: MockHarnessSimulationMode): void {
  activeMode = mode;
  const mapped = mapHarnessModeToFacilitatorModes(mode);
  facilitator.setVerifyMode(mapped.verifyMode);
  facilitator.setSettleMode(mapped.settleMode);
}

applyHarnessMode(activeMode);

function buildOrchestratorDeps(env: MainnetEnv): MainnetOrchestratorDeps {
  const resourceServer = createMainnetOrchestratorResourceServer(facilitator);
  return {
    coordinator: env.PAYMENT_COORDINATOR,
    facilitator,
    policy: { sellerAddress: MAINNET_TEST_SELLER },
    resourceServer,
  };
}

export function createMainnetMockHarnessApp() {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json(
      {
        success: true,
        service: "x402 Mainnet Mock Browser Harness",
        status: "healthy",
        simulated: true,
      },
      200,
      { "Cache-Control": "no-store" },
    ),
  );

  app.get("/mock-pay", (c) =>
    c.html(buildMockPayPageHtml(), 200, {
      "Content-Security-Policy": MOCK_PAY_CONTENT_SECURITY_POLICY,
      "Cache-Control": "no-store",
    }),
  );

  app.get("/mock-pay.js", (c) =>
    c.body(MOCK_PAY_JS, 200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    }),
  );

  app.get("/mock-pay.css", (c) =>
    c.body(MOCK_PAY_CSS, 200, {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": "no-store",
    }),
  );

  app.post("/mock-control", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { mode?: MockHarnessSimulationMode } | null;
    if (!body?.mode) {
      return c.json({ ok: false, error: "Missing mode." }, 400, {
        "Cache-Control": "no-store",
      });
    }
    applyHarnessMode(body.mode);
    return c.json({ ok: true, mode: activeMode }, 200, {
      "Cache-Control": "no-store",
    });
  });

  app.get("/pay/status/:paymentIdentifier", payStatusHandler);

  app.all("/v1/example", async (c) => {
    const env = c.env as MainnetEnv;
    const deps = buildOrchestratorDeps(env);
    if (!deps.resourceServer) {
      throw new Error("Resource server is required.");
    }
    await deps.resourceServer.initialize();
    const ctx: MainnetOrchestratorContext = {
      deps,
      request: {
        method: c.req.method,
        url: new URL(c.req.url),
        paymentSignatureHeader:
          c.req.header("payment-signature") ?? c.req.header("PAYMENT-SIGNATURE") ?? undefined,
      },
    };
    return handleMainnetExampleRequest(ctx);
  });

  return app;
}

export default {
  async fetch(
    request: Request,
    env: MainnetEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const app = createMainnetMockHarnessApp();
    return app.fetch(request, env, ctx);
  },
};
