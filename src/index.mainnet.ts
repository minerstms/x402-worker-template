/// <reference path="../worker-configuration.mainnet.d.ts" />

import { Hono } from "hono";
import { MAINNET_SERVICE_NAME } from "./mainnet/mainnet-config.js";
import { payStatusHandler } from "./mainnet/routes/pay-status.js";

export { PaymentCoordinatorDurableObject } from "./mainnet/durable/PaymentCoordinatorDurableObject.js";

export function createMainnetApp() {
  const app = new Hono();

  app.get("/health", (c) => {
    return c.json({
      success: true,
      service: MAINNET_SERVICE_NAME,
      status: "healthy",
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/pay/status/:paymentIdentifier", payStatusHandler);

  app.all("/v1/example", (c) => {
    return c.json(
      {
        success: false,
        error: {
          code: "NOT_ENABLED",
          message:
            "Mainnet paid-route orchestration is not enabled in this proof worker.",
        },
      },
      503,
    );
  });

  return app;
}

export default {
  async fetch(
    request: Request,
    env: MainnetEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const app = createMainnetApp();
    return app.fetch(request, env, ctx);
  },
};
