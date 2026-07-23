import type { Context } from "hono";
import { SERVICE_NAME } from "../config.js";

export function healthHandler(c: Context) {
  return c.json({
    success: true,
    service: SERVICE_NAME,
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
}
