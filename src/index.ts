import { Hono } from "hono";
import type { FacilitatorClient } from "@x402/core/server";
import type { AppEnv } from "./config.js";
import { resolveConfig } from "./config.js";
import { createRequestId, logStructured } from "./logging.js";
import { buildOpenApiDocument } from "./openapi.js";
import { createPaymentMiddleware } from "./payment.js";
import { healthHandler } from "./routes/health.js";
import {
  createExampleHandler,
  validateExampleQuery,
  type ExampleDeps,
} from "./routes/example.js";

export type CreateAppOptions = {
  env?: Partial<AppEnv>;
  syncFacilitatorOnStart?: boolean;
  useStaticFacilitator?: boolean;
  facilitatorClient?: FacilitatorClient;
  onExampleHandlerExecuted?: () => void;
  now?: () => Date;
};

type Variables = {
  requestId: string;
};

export function createApp(options: CreateAppOptions = {}) {
  const config = resolveConfig(options.env ?? {});
  const app = new Hono<{ Bindings: AppEnv; Variables: Variables }>();

  app.use("*", async (c, next) => {
    const requestId = createRequestId();
    c.set("requestId", requestId);
    const started = Date.now();
    await next();
    logStructured("info", {
      requestId,
      route: new URL(c.req.url).pathname,
      method: c.req.method,
      status: c.res.status,
      durationMs: Date.now() - started,
    });
  });

  app.get("/health", healthHandler);
  app.get("/openapi.json", (c) => {
    return c.json(buildOpenApiDocument(config));
  });

  app.use("/v1/example", validateExampleQuery);

  app.use(
    createPaymentMiddleware(config, {
      syncFacilitatorOnStart: options.syncFacilitatorOnStart ?? true,
      useStaticFacilitator: options.useStaticFacilitator ?? false,
      facilitatorClient: options.facilitatorClient,
    }),
  );

  const exampleDeps: ExampleDeps = {
    onHandlerExecuted: options.onExampleHandlerExecuted,
    now: options.now,
  };
  app.get("/v1/example", createExampleHandler(exampleDeps));

  app.onError((err, c) => {
    const requestId = c.get("requestId") ?? createRequestId();
    logStructured("error", {
      requestId,
      route: new URL(c.req.url).pathname,
      method: c.req.method,
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Unhandled application error",
    });
    return c.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred.",
        },
        requestId,
      },
      500,
    );
  });

  return app;
}

/** Cache apps per env fingerprint so facilitator initialize runs once per isolate. */
const appCache = new Map<string, ReturnType<typeof createApp>>();

function envCacheKey(env: AppEnv): string {
  return [
    env.X402_NETWORK,
    env.X402_PRICE_USD,
    env.X402_FACILITATOR_URL,
    env.X402_PAY_TO_ADDRESS,
  ].join("|");
}

export default {
  async fetch(
    request: Request,
    env: AppEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const key = envCacheKey(env);
    let app = appCache.get(key);
    if (!app) {
      app = createApp({
        env,
        syncFacilitatorOnStart: true,
        useStaticFacilitator: false,
      });
      appCache.set(key, app);
    }
    return app.fetch(request, env, ctx);
  },
};
