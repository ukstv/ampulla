export {
  NotAModuleError,
  InvalidProviderError,
  ProviderNotFoundError,
  ProviderNotInitializedError,
  DuplicateProviderError,
  InvalidExportError,
  CircularDependencyError,
};

/** Thrown when a class passed to `Container.create()` has no `@Module` decorator. */
class NotAModuleError extends Error {
  constructor(className: string) {
    super(`Class is not a module: ${className}`);
    this.name = "NotAModuleError";
  }
}

/** Thrown when a bare `InjectionToken` appears in a `providers` array instead of a provider descriptor. */
class InvalidProviderError extends Error {
  constructor(key: string | symbol) {
    super(
      `Token ${String(key)} cannot be used as a provider directly; use useClass, useValue, or useFactory`,
    );
    this.name = "InvalidProviderError";
  }
}

/** Thrown when the container cannot find a provider for a requested token. */
class ProviderNotFoundError extends Error {
  constructor(token: string, fromModule: string) {
    super(`No provider for ${token} visible from ${fromModule}`);
    this.name = "ProviderNotFoundError";
  }
}

/** Thrown when the same token is registered more than once in a single module. */
class DuplicateProviderError extends Error {
  constructor(token: string, moduleName: string) {
    super(`Duplicate provider ${token} in ${moduleName}`);
    this.name = "DuplicateProviderError";
  }
}

/**
 * Thrown when a module's `exports` array contains a token that the module
 * does not provide, or a module class that the module does not import.
 */
class InvalidExportError extends Error {
  constructor(moduleName: string, exported: string, detail: string) {
    super(`${moduleName} exports ${exported} but ${detail}`);
    this.name = "InvalidExportError";
  }
}

/** Thrown when `container.get()` is called on a token that is registered but whose instance is missing — e.g. after `dispose()`. */
class ProviderNotInitializedError extends Error {
  constructor(token: string) {
    super(`Provider ${token} exists but was not initialized`);
    this.name = "ProviderNotInitializedError";
  }
}

/** Thrown when the container detects a circular dependency during resolution. */
class CircularDependencyError extends Error {
  constructor(token: string, moduleName: string) {
    super(`Circular dependency while resolving ${token} in ${moduleName}`);
    this.name = "CircularDependencyError";
  }
}
