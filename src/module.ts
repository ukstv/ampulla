import {
  ClassDecoratorFn,
  ConcreteCtor,
  Ctor,
  DependencyToken,
  AnyDepArg,
  TokenValues,
} from "./injectable.js";
import { NotAModuleError } from "./errors.js";

export type { AnyDependencyToken, AnyProvider, ModuleClass };
export { getModuleMetadata };

/** Provider descriptor that instantiates `useClass` and registers the result under `provide`. */
type ClassProvider<T = unknown> = {
  provide: DependencyToken<T>;
  useClass: ConcreteCtor<T>;
};

/** Provider descriptor that registers a pre-existing value under `provide`. The container returns the exact reference on every `get()` call. */
type ValueProvider<T = unknown> = {
  provide: DependencyToken<T>;
  useValue: T;
};

/** `FactoryProvider` without type parameters — used internally where the exact types are not relevant. */
type AnyFactoryProvider = FactoryProvider<any, readonly AnyDepArg[]>;

/** `DependencyToken` without its type parameter — used internally where the resolved type is not relevant. */
type AnyDependencyToken = DependencyToken<any>;

/** Provider descriptor that calls `useFactory` with resolved `inject` dependencies and registers the return value under `provide`. The factory may be async. */
type FactoryProvider<
  T,
  TDeps extends readonly AnyDepArg[] = readonly AnyDepArg[],
> = {
  provide: DependencyToken<T>;
  useFactory: (...args: TokenValues<TDeps>) => T | Promise<T>;
  inject: TDeps;
};

/** Any value accepted in a module's `providers` array: a bare class constructor or one of the three provider descriptor shapes. */
type AnyProvider =
  | ConcreteCtor<any>
  | ClassProvider<any>
  | ValueProvider<any>
  | AnyFactoryProvider;

/** Any class constructor that can be passed to `@Module` or `Container.create`. */
type ModuleClass = Ctor<unknown>;

/** Configuration object passed to `@Module`. */
export interface ModuleMetadata {
  /** Other modules whose exported providers become visible to this module's providers. */
  imports?: readonly ModuleClass[];
  /** Providers owned by this module. Each entry is either a bare class constructor or a `useClass` / `useValue` / `useFactory` descriptor. */
  providers?: readonly AnyProvider[];
  /**
   * Tokens or modules to make visible to importing modules.
   *
   * - A `DependencyToken` must correspond to a provider in this module's own `providers`.
   * - A `ModuleClass` must appear in this module's `imports`; its exports are re-exported transitively.
   */
  exports?: readonly (DependencyToken | ModuleClass)[];
}

export const K_MODULE_METADATA: unique symbol = Symbol(
  "ampulla:module-metadata",
);

/**
 * Marks a class as a DI module and attaches the given metadata to it.
 *
 * Modules are the unit of organization in ampulla. They declare which providers
 * they own (`providers`), which other modules they depend on (`imports`), and
 * which of their providers they expose to importers (`exports`).
 *
 * @example
 * @Module({
 *   imports: [DatabaseModule],
 *   providers: [UserService],
 *   exports: [UserService],
 * })
 * class UserModule {}
 */
export function Module(
  metadata: ModuleMetadata,
): ClassDecoratorFn<ModuleClass> {
  return function <TClass extends ModuleClass>(
    value: TClass,
    _context: ClassDecoratorContext<TClass>,
  ): void {
    Object.defineProperty(value, K_MODULE_METADATA, {
      value: metadata,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  };
}

function getModuleMetadata(moduleClass: ModuleClass): ModuleMetadata {
  if (!(K_MODULE_METADATA in moduleClass)) {
    throw new NotAModuleError(moduleClass.name);
  }
  const metadata = moduleClass[K_MODULE_METADATA];
  if (!metadata) throw new NotAModuleError(moduleClass.name);
  return metadata;
}

/**
 * Creates a `ClassProvider` that registers `useClass` under `provide`.
 *
 * Use this when the token and the implementation class are different — for
 * example, registering a concrete class under an abstract token or interface token.
 *
 * @example
 * useClass(ILogger, ConsoleLogger)
 */
export function useClass<T>(
  provide: DependencyToken<T>,
  useClass: ConcreteCtor<T>,
): ClassProvider<T> {
  return { provide, useClass };
}

/**
 * Creates a `ValueProvider` that registers a pre-existing value under `provide`.
 *
 * The container returns the exact reference on every `get()` call — no cloning,
 * no instantiation. Useful for config objects, constants, and third-party instances.
 *
 * @example
 * useValue(PORT, 3000)
 * useValue(CONFIG, { host: "localhost", db: "app" })
 */
export function useValue<T>(
  provide: DependencyToken<T>,
  useValue: T,
): ValueProvider<T> {
  return { provide, useValue };
}

/**
 * Creates a `FactoryProvider` that calls `useFactory` with resolved `inject`
 * dependencies and registers the return value under `provide`.
 *
 * The factory may return a `Promise`; the container awaits it before making
 * the value available to dependents. Async factories for independent providers
 * run concurrently.
 *
 * @example
 * useFactory(DB_URL, [CONFIG], (config) => `postgres://localhost/${config.db}`)
 * useFactory(DB, [DB_URL], async (url) => { const c = new Pool(url); await c.connect(); return c; })
 */
export function useFactory<T, const TDeps extends readonly AnyDepArg[]>(
  provide: DependencyToken<T>,
  inject: TDeps,
  useFactory: (...args: TokenValues<TDeps>) => T | Promise<T>,
): FactoryProvider<T, TDeps> {
  return {
    provide,
    inject,
    useFactory,
  };
}
