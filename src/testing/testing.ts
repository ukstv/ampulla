import type { AnyDependencyToken, ModuleMetadata } from "../module.js";
import type { TokenValue } from "../injectable.js";
import { Container } from "../container.js";
import { Module } from "../module.js";

export { TestingContainer };
export type { TestingModuleMetadata };

/**
 * Utilities for constructing lightweight containers in tests.
 *
 * @example
 * // One-liner for a single provider:
 * const svc = await TestingContainer.use(UserService, {
 *   providers: [useValue(DB_URL, "postgres://localhost/test"), UserService],
 * });
 *
 * // Full container for multi-assertion tests:
 * const container = await TestingContainer.fromModule({
 *   providers: [Logger, UserService],
 * });
 */
const TestingContainer = {
  fromModule,
  use,
};

/** `ModuleMetadata` extended with an optional `name` for the ephemeral test module. */
type TestingModuleMetadata = ModuleMetadata & { name?: string };

/**
 * Creates a temporary `@Module` from `metadata`, initializes it, and returns
 * the resulting `Container`. Equivalent to declaring a one-off module class and
 * calling `Container.create` on it.
 *
 * The container runs the full lifecycle — `@OnModuleInit` hooks fire before the
 * promise resolves.
 */
function fromModule(metadata: TestingModuleMetadata): Promise<Container> {
  @Module(metadata)
  class TestingModule {
    readonly name: string;
    constructor() {
      this.name = metadata.name ?? "TestingModule";
    }
  }
  return Container.create(TestingModule);
}

/**
 * Convenience wrapper: creates a module from `metadata`, initializes it, and
 * returns the resolved value for `token`. Ideal when a test needs exactly one
 * provider and no further container access.
 *
 * @example
 * const svc = await TestingContainer.use(UserService, {
 *   providers: [useValue(DB_URL, "postgres://test"), UserService],
 * });
 */
async function use<TToken extends AnyDependencyToken>(
  token: TToken,
  metadata: TestingModuleMetadata,
): Promise<TokenValue<TToken>> {
  const container = await fromModule(metadata);
  return container.get(token);
}
