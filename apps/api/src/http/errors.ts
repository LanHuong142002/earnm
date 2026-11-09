import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, "not_found", "Not found."));
};

function isBodyParserSyntaxError(err: unknown): boolean {
  return (
    err instanceof SyntaxError &&
    (err as { type?: unknown }).type === "entity.parse.failed"
  );
}

function isBodyTooLarge(err: unknown): boolean {
  return (err as { type?: unknown } | null)?.type === "entity.too.large";
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    const fields = [
      ...new Set(err.issues.map((i) => i.path.join(".") || "body")),
    ];
    res.status(400).json({
      error: {
        code: "validation_failed",
        message: `Invalid fields: ${fields.join(", ")}.`,
      },
    });
    return;
  }
  if (isBodyParserSyntaxError(err)) {
    res
      .status(400)
      .json({ error: { code: "invalid_json", message: "Request body is not valid JSON." } });
    return;
  }
  if (isBodyTooLarge(err)) {
    res
      .status(413)
      .json({ error: { code: "payload_too_large", message: "Request body is too large." } });
    return;
  }
  // Log only the error name and stack, never request data.
  const e = err instanceof Error ? err : new Error("non-error thrown");
  console.error(`${e.name}: ${e.stack ?? ""}`);
  res
    .status(500)
    .json({ error: { code: "internal_error", message: "Something went wrong." } });
};
