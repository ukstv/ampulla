export type {
  Ctor,
  ConcreteCtor,
  InjectionToken,
  DependencyToken,
  OptionalToken,
  DepArg,
  AnyDepArg,
  TokenValues,
  TokenValue,
  InjectableClass,
  ClassDecoratorFn,
};
export { injection, optional, isOptionalToken, Injectable, getInjectableDeps };

/** Any class constructor, including abstract ones. Used as a dependency token when the class itself is the thing to inject. */
type Ctor<T = unknown> = abstract new (...args: any[]) => T;

/** A concrete (non-abstract) class constructor. Used as the implementation side of `useClass` and as the target for `new` during provider instantiation. */
type ConcreteCtor<T = unknown> = new (...args: any[]) => T;

/** The function signature for a standard JavaScript class decorator that constrains the decorated class to extend `T`. */
type ClassDecoratorFn<T extends abstract new (...args: any) => any> = <
  TClass extends T,
>(
  value: TClass,
  context: ClassDecoratorContext<TClass>,
) => void;

/**
 * An opaque token used to identify a dependency in the container.
 *
 * Tokens are matched by **object identity**, not by `key` equality — two
 * separately-created `injection<T>("FOO")` calls produce distinct tokens that the
 * container treats as unrelated. This is intentional: it prevents accidental
 * collisions between modules that happen to use the same string. The `key`
 * field is only used in error messages for human-readable diagnostics.
 *
 * Always export the token constant and import it wherever it is needed.
 */
interface InjectionToken<T> {
  /** Human-readable label used only in error messages. Not used for lookup. */
  readonly key: string | symbol;
  /** Phantom type field — never set at runtime. Exists solely so TypeScript can infer `T` in `TokenValue<InjectionToken<T>>`. */
  readonly __type?: T;
}

/** A token the container can resolve: either a class constructor or an `InjectionToken`. */
type DependencyToken<T = unknown> = Ctor<T> | InjectionToken<T>;

/** Unique symbol used as the brand key in `OptionalToken`. Not exported — only `isOptionalToken` should inspect it. */
const K_OPTIONAL: unique symbol = Symbol("ampulla:optional");

/**
 * Wraps a `DependencyToken` to mark it as optional. When the container cannot
 * find a provider for the wrapped token, it injects `undefined` instead of throwing.
 *
 * @example
 * const CONFIG = injection<AppConfig>("CONFIG");
 *
 * @Injectable(Logger, optional(CONFIG))
 * class UserService {
 *   constructor(private logger: Logger, private config?: AppConfig) {}
 * }
 */
type OptionalToken<T> = { readonly [K_OPTIONAL]: true; readonly token: DependencyToken<T> };

/** A value accepted in an `@Injectable` deps list or a `useFactory` inject array: either a required token or an `optional()`-wrapped token. */
type DepArg<T = unknown> = DependencyToken<T> | OptionalToken<T>;

/** `DepArg` without its type parameter — used internally where the resolved type is not relevant. */
type AnyDepArg = DepArg<any>;

/** Maps a single `DepArg` to the type it resolves to. Optional tokens resolve to `T | undefined`. */
type TokenValue<T> =
  T extends Ctor<infer V> ? V :
  T extends InjectionToken<infer V> ? V :
  T extends OptionalToken<infer V> ? V | undefined :
  never;

/** Maps a tuple of `DepArg`s to the tuple of types they resolve to. Used to type-check `@Injectable` arguments against constructor parameters. */
type TokenValues<TTokens extends readonly DepArg[]> = {
  readonly [K in keyof TTokens]: TokenValue<TTokens[K]>;
};

/**
 * Creates a new injection token for type `T`.
 *
 * Each call returns a **unique** token object. Pass the same reference
 * everywhere you want to refer to the same dependency — do not recreate it.
 *
 * @param key Label shown in error messages. Has no effect on identity or lookup.
 */
function injection<T>(key: string | symbol): InjectionToken<T> {
  return { key };
}

/**
 * Wraps a dependency token to mark it as optional.
 *
 * When the container cannot find a provider for the wrapped token, it injects
 * `undefined` instead of throwing `ProviderNotFoundError`. The constructor
 * parameter must be typed as `T | undefined` to match.
 *
 * @example
 * const CONFIG = injection<AppConfig>("CONFIG");
 * export const OPTIONAL_CONFIG = optional(CONFIG); // reusable optional token
 *
 * @Injectable(Logger, optional(CONFIG))
 * class UserService {
 *   constructor(private logger: Logger, private config?: AppConfig) {}
 * }
 */
function optional<T>(token: DependencyToken<T>): OptionalToken<T> {
  return { [K_OPTIONAL]: true, token };
}

/** Returns `true` if `dep` is an `OptionalToken` produced by `optional()`. */
function isOptionalToken(dep: AnyDepArg): dep is OptionalToken<any> {
  return typeof dep === "object" && dep !== null && K_OPTIONAL in dep;
}

/** Unique symbol used as the property key for storing `@Injectable` dep metadata on a class via `Object.defineProperty`. Not exported — only `getInjectableDeps` should read it. */
const K_INJECTABLE_DEPS: unique symbol = Symbol("injectableDeps");

/**
 * Declares the dependency tokens the container will inject into the class
 * constructor, in order.
 *
 * **The decorator arguments are the sole source of DI metadata.** TypeScript
 * constructor parameter types are erased at runtime and are never read by the
 * container. A class whose constructor accepts a parameter but whose
 * `@Injectable()` lists no tokens will receive `undefined` for that parameter —
 * the container will not infer the dependency automatically.
 *
 * Any mismatch between the declared tokens and the constructor signature is a
 * compile-time error: the decorator constrains the class to be constructable
 * with exactly `TokenValues<TDeps>`, so forgetting a token or providing the
 * wrong type is caught by the TypeScript compiler before runtime.
 *
 * Wrap a token with `optional()` to mark it as optional. The container injects
 * `undefined` if the token is not registered, and the compiler enforces that the
 * corresponding constructor parameter is typed `T | undefined`.
 *
 * @example
 * const DB = injection<Database>("DB");
 * const CONFIG = injection<AppConfig>("CONFIG");
 *
 * @Injectable(DB, optional(CONFIG))
 * class UserRepo {
 *   constructor(private db: Database, private config?: AppConfig) {}
 * }
 */
function Injectable<const TDeps extends readonly DepArg[]>(
  ...deps: TDeps
): ClassDecoratorFn<{ new (...args: TokenValues<TDeps>): unknown }> {
  return function <
    TClass extends abstract new (...args: TokenValues<TDeps>) => unknown,
  >(value: TClass, _context: ClassDecoratorContext<TClass>): void {
    Object.defineProperty(value, K_INJECTABLE_DEPS, {
      value: deps,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  };
}

/** A class constructor that may carry `@Injectable` dependency metadata. */
type InjectableClass<T = unknown> = Ctor<T> & {
  readonly [K_INJECTABLE_DEPS]?: readonly AnyDepArg[];
};

/** Returns the dependency args declared via `@Injectable` on `ctor`, or an empty array if the decorator was not applied. */
function getInjectableDeps(ctor: Ctor): readonly AnyDepArg[] {
  return (ctor as InjectableClass)[K_INJECTABLE_DEPS] ?? [];
}
