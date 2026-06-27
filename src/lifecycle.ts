export { OnModuleInit, getOnModuleInitMethodName };
export { OnModuleDestroy, getOnModuleDestroyMethodName };
export type { LifecycleMethod };

/** Signature required for methods registered via `@OnModuleInit` and `@OnModuleDestroy`. May be sync or async. */
type LifecycleMethod = () => void | Promise<void>;

/** Unique symbol used as the property key for storing the `@OnModuleInit` method name on a class. Not exported — only `getOnModuleInitMethodName` should read it. */
const K_ON_MODULE_INIT: unique symbol = Symbol("ampulla:onModuleInit");

/**
 * Marks a class as having an `onModuleInit` lifecycle hook.
 *
 * The container calls the designated method on each provider instance after all
 * providers in the graph have been instantiated, in dependency order (deps first).
 *
 * @example
 * // Default: expects an `onModuleInit()` method on the class.
 * @OnModuleInit()
 * class MyService {
 *   onModuleInit() { ... }
 * }
 *
 * @example
 * // Custom method name:
 * @OnModuleInit("setup")
 * class MyService {
 *   setup() { ... }
 * }
 */
function OnModuleInit(): <
  TClass extends abstract new (...args: any[]) => {
    onModuleInit: LifecycleMethod;
  },
>(
  value: TClass,
  context: ClassDecoratorContext<TClass>,
) => void;
function OnModuleInit<const TMethod extends string>(
  method: TMethod,
): <
  TClass extends abstract new (
    ...args: any[]
  ) => Record<TMethod, LifecycleMethod>,
>(
  value: TClass,
  context: ClassDecoratorContext<TClass>,
) => void;

function OnModuleInit(method: string = "onModuleInit") {
  return (
    value: abstract new (...args: any[]) => any,
    _context: ClassDecoratorContext,
  ): void => {
    Object.defineProperty(value, K_ON_MODULE_INIT, {
      value: method,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  };
}

function getOnModuleInitMethodName(
  ctor: abstract new (...args: any[]) => any,
): string | undefined {
  return (ctor as any)[K_ON_MODULE_INIT];
}

/** Unique symbol used as the property key for storing the `@OnModuleDestroy` method name on a class. Not exported — only `getOnModuleDestroyMethodName` should read it. */
const K_ON_MODULE_DESTROY: unique symbol = Symbol("ampulla:onModuleDestroy");

/**
 * Marks a class as having an `onModuleDestroy` lifecycle hook.
 *
 * The container calls the designated method on each provider instance when
 * `container.dispose()` / `[Symbol.asyncDispose]` is called, in reverse
 * dependency order (dependents first, deps last).
 *
 * @example
 * // Default: expects an `onModuleDestroy()` method on the class.
 * @OnModuleDestroy()
 * class MyService {
 *   onModuleDestroy() { ... }
 * }
 *
 * @example
 * // Custom method name:
 * @OnModuleDestroy("teardown")
 * class MyService {
 *   teardown() { ... }
 * }
 */
function OnModuleDestroy(): <
  TClass extends abstract new (...args: any[]) => {
    onModuleDestroy: LifecycleMethod;
  },
>(
  value: TClass,
  context: ClassDecoratorContext<TClass>,
) => void;
function OnModuleDestroy<const TMethod extends string>(
  method: TMethod,
): <
  TClass extends abstract new (
    ...args: any[]
  ) => Record<TMethod, LifecycleMethod>,
>(
  value: TClass,
  context: ClassDecoratorContext<TClass>,
) => void;

function OnModuleDestroy(method: string = "onModuleDestroy") {
  return (
    value: abstract new (...args: any[]) => any,
    _context: ClassDecoratorContext,
  ): void => {
    Object.defineProperty(value, K_ON_MODULE_DESTROY, {
      value: method,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  };
}

function getOnModuleDestroyMethodName(
  ctor: abstract new (...args: any[]) => any,
): string | undefined {
  return (ctor as any)[K_ON_MODULE_DESTROY];
}
