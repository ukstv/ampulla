/**
 * Shared low-level TypeScript utility types used across ampulla's public API.
 *
 * Import these when building extensions or custom decorators on top of ampulla.
 *
 * @module types
 */
export type { ClassDecoratorFn, ClassMethodDecoratorFn, Ctor, ConcreteCtor };

/** Any class constructor, including abstract ones. Used as a dependency token when the class itself is the thing to inject. */
type Ctor<T = unknown> = abstract new (...args: any[]) => T;

/** A concrete (non-abstract) class constructor. Used as the implementation side of `useClass` and as the target for `new` during provider instantiation. */
type ConcreteCtor<T = unknown> = new (...args: any[]) => T;

/** The function signature for a standard JavaScript class decorator that constrains the decorated class to extend `T`. */
type ClassDecoratorFn<
  T extends abstract new (...args: any) => any = new (...args: any) => any,
> = <TClass extends T>(
  value: TClass,
  context: ClassDecoratorContext<TClass>,
) => void;

type ClassMethodDecoratorFn<
  TThis = unknown,
  TValue extends (this: TThis, ...args: any) => any = (
    this: TThis,
    ...args: any
  ) => any,
> = <KThis extends TThis = TThis, KValue extends TValue = TValue>(
  value: KValue,
  context: ClassMethodDecoratorContext<KThis, KValue>,
) => void;
