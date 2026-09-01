export class RouterError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ status?: number, cause?: unknown, details?: unknown }} [options]
   */
  constructor(code, message, options = {}) {
    super(message, { cause: options.cause });
    this.name = "RouterError";
    this.code = code;
    this.status = options.status ?? 500;
    this.details = options.details;
  }
}

/** @param {unknown} error */
export function publicError(error) {
  if (error instanceof RouterError) {
    return {
      error: {
        type: error.code,
        code: error.code,
        message: error.message,
      },
    };
  }

  return {
    error: {
      type: "router_error",
      code: "router_error",
      message: "The router could not complete this request.",
    },
  };
}
