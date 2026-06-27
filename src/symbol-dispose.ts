/* v8 ignore next 2 */
if (typeof Symbol.dispose !== "symbol")
  Object.defineProperty(Symbol, "dispose", { value: Symbol.for("dispose") });

/* v8 ignore next 3 */
if (typeof Symbol.asyncDispose !== "symbol")
  Object.defineProperty(Symbol, "asyncDispose", {
    value: Symbol.for("asyncDispose"),
  });

export type {};
