import { TRPCError } from "@trpc/server";

export type ShieldErrorCode =
  | "CONFIGURATION"
  | "VALIDATION"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL";

export class ShieldError extends Error {
  public readonly code: ShieldErrorCode;
  public override readonly cause?: unknown;

  public constructor(code: ShieldErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.cause = options?.cause;
  }
}

export class ConfigurationError extends ShieldError {
  public override readonly name = "ConfigurationError";
  public constructor(message: string, options?: { cause?: unknown }) {
    super("CONFIGURATION", message, options);
  }
}

export class ValidationError extends ShieldError {
  public override readonly name = "ValidationError";
  public constructor(message: string, options?: { cause?: unknown }) {
    super("VALIDATION", message, options);
  }
}

export class AuthorizationError extends ShieldError {
  public override readonly name = "AuthorizationError";
  public constructor(message = "Authentication is required.", options?: { cause?: unknown }) {
    super("UNAUTHORIZED", message, options);
  }
}

export class ForbiddenError extends ShieldError {
  public override readonly name = "ForbiddenError";
  public constructor(message = "You do not have access to this resource.", options?: { cause?: unknown }) {
    super("FORBIDDEN", message, options);
  }
}

export class NotFoundError extends ShieldError {
  public override readonly name = "NotFoundError";
  public constructor(message = "Resource not found.", options?: { cause?: unknown }) {
    super("NOT_FOUND", message, options);
  }
}

export class ConflictError extends ShieldError {
  public override readonly name = "ConflictError";
  public constructor(message = "Resource conflict.", options?: { cause?: unknown }) {
    super("CONFLICT", message, options);
  }
}

export function toTRPCError(error: unknown): TRPCError {
  if (error instanceof TRPCError) {
    return error;
  }

  if (error instanceof ShieldError) {
    switch (error.code) {
      case "VALIDATION":
        return new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
      case "UNAUTHORIZED":
        return new TRPCError({ code: "UNAUTHORIZED", message: error.message, cause: error });
      case "FORBIDDEN":
        return new TRPCError({ code: "FORBIDDEN", message: error.message, cause: error });
      case "NOT_FOUND":
        return new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
      case "CONFLICT":
        return new TRPCError({ code: "CONFLICT", message: error.message, cause: error });
      case "CONFIGURATION":
      case "INTERNAL":
        return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message, cause: error });
    }
  }

  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: error instanceof Error ? error.message : "Unknown shield error.",
    cause: error,
  });
}
