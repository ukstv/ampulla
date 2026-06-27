export type { Tag };
export { tag, Tagged, getTagsFromClass, allTagged };

/**
 * An opaque tag used to group providers by role.
 *
 * Tags are matched by **object identity**, not by `label` equality — two
 * separately-created `tag("controller")` calls produce distinct tags.
 * Always export the tag constant and import it wherever it is needed.
 *
 * @example
 * export const CONTROLLER = tag<AbstractController>("controller");
 *
 * @Tagged(CONTROLLER)
 * @Injectable()
 * class UserController extends AbstractController {}
 *
 * const controllers = allTagged(container, CONTROLLER);
 */
type Tag<T = unknown> = {
  readonly label: string | symbol;
  readonly __type?: T;
};

const K_TAGS: unique symbol = Symbol("ampulla:tags");

/**
 * Creates a new tag for grouping providers by role.
 *
 * Each call returns a **unique** tag object. The type parameter `T` constrains
 * what `container.getAllTagged()` returns for this tag.
 *
 * @param label Human-readable label used only in debugging. Has no effect on identity.
 */
function tag<T = object>(label: string | symbol): Tag<T> {
  return { label };
}

/**
 * Marks a class with one or more tags so that `container.getAllTagged()` can
 * retrieve all instances sharing a tag.
 *
 * A class can carry multiple tags; each tag is independent and queryable
 * separately.
 */
function Tagged(...tags: readonly Tag<any>[]) {
  return (
    value: abstract new (...args: any[]) => any,
    _context: ClassDecoratorContext,
  ): void => {
    Object.defineProperty(value, K_TAGS, {
      value: tags,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  };
}

function getTagsFromClass(
  ctor: abstract new (...args: any[]) => any,
): readonly Tag<any>[] {
  return (ctor as any)[K_TAGS] ?? [];
}

/**
 * Returns all instances from `entries` whose token carries the given tag.
 *
 * Works on any iterable of `[token, instance]` pairs — pass a `Container`
 * directly since it implements `Symbol.iterator` over those pairs.
 *
 * Tags are matched by **object identity**. Only class tokens (functions) can
 * carry tags; value and factory providers are automatically skipped.
 */
function allTagged<T>(
  entries: Iterable<readonly [unknown, unknown]>,
  t: Tag<T>,
): T[] {
  const result: T[] = [];
  for (const [token, instance] of entries) {
    if (typeof token !== "function") continue;
    const ctor = token as abstract new (...args: any[]) => any;
    const tags = getTagsFromClass(ctor);
    if (tags.includes(t)) {
      result.push(instance as T);
    }
  }
  return result;
}
