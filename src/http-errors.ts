export { ValidationError, ExtractionError, InvalidHandlerError };

/** Thrown when a `.valid()` schema check fails inside an extractor. Surfaces as `.cause` on `ExtractionError`. */
class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Thrown when a `@Extract` extractor fails. Inspect `.cause` for the underlying error. */
class ExtractionError extends Error {
  constructor(cause: unknown) {
    super("Extractor failed", { cause });
    this.name = "ExtractionError";
  }
}

/** Thrown when `registerControllers` finds a route entry whose handler name does not resolve to a function on the controller instance. */
class InvalidHandlerError extends Error {
  constructor(handlerName: string, controllerName: string) {
    super(`Handler "${handlerName}" is not a function on ${controllerName}`);
    this.name = "InvalidHandlerError";
  }
}
