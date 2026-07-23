export type ErrorCode =
  | "MISSING_VALUE"
  | "INVALID_VALUE"
  | "PAYMENT_REQUIRED"
  | "PAYMENT_INVALID"
  | "PAYMENT_SETTLEMENT_FAILED"
  | "INTERNAL_ERROR";

export type ErrorBody = {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
  };
  requestId: string;
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string, status: number) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

export function errorBody(
  code: ErrorCode,
  message: string,
  requestId: string,
): ErrorBody {
  return {
    success: false,
    error: { code, message },
    requestId,
  };
}

export function missingValue(requestId: string): ErrorBody {
  return errorBody(
    "MISSING_VALUE",
    "Query parameter 'value' is required.",
    requestId,
  );
}

export function invalidValue(requestId: string): ErrorBody {
  return errorBody(
    "INVALID_VALUE",
    "Query parameter 'value' must be a single non-blank string within the allowed length.",
    requestId,
  );
}

export function httpStatusForCode(code: ErrorCode): number {
  switch (code) {
    case "MISSING_VALUE":
    case "INVALID_VALUE":
      return 400;
    case "PAYMENT_REQUIRED":
    case "PAYMENT_INVALID":
      return 402;
    case "PAYMENT_SETTLEMENT_FAILED":
      return 502;
    case "INTERNAL_ERROR":
    default:
      return 500;
  }
}
