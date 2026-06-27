import "./symbol-dispose.js";
import {
  AnyDependencyToken,
  getModuleMetadata,
  ModuleClass,
  AnyProvider,
} from "./module.js";
import { ConcreteCtor, getInjectableDeps, isOptionalToken, AnyDepArg, TokenValue } from "./injectable.js";
import {
  getOnModuleInitMethodName,
  getOnModuleDestroyMethodName,
} from "./lifecycle.js";
import {
  InvalidProviderError,
  ProviderNotFoundError,
  ProviderNotInitializedError,
  DuplicateProviderError,
  InvalidExportError,
  CircularDependencyError,
} from "./errors.js";

function formatToken(token: AnyDependencyToken): string {
  if (typeof token === "function") {
    return token.name;
  }
  return String(token.key);
}

type NormalizedProvider =
  | {
      kind: "class";
      token: AnyDependencyToken;
      useClass: ConcreteCtor;
    }
  | {
      kind: "value";
      token: AnyDependencyToken;
      useValue: unknown;
    }
  | {
      kind: "factory";
      token: AnyDependencyToken;
      inject: readonly AnyDepArg[];
      useFactory: (...args: any[]) => unknown | Promise<unknown>;
    };

function normalizeProvider(provider: AnyProvider): NormalizedProvider {
  if (typeof provider === "function") {
    return {
      kind: "class",
      token: provider,
      useClass: provider,
    };
  }

  if ("key" in provider) {
    throw new InvalidProviderError((provider as { key: string | symbol }).key);
  }

  if ("useClass" in provider) {
    return {
      kind: "class",
      token: provider.provide,
      useClass: provider.useClass,
    };
  }

  if ("useValue" in provider) {
    return {
      kind: "value",
      token: provider.provide,
      useValue: provider.useValue,
    };
  }

  return {
    kind: "factory",
    token: provider.provide,
    inject: provider.inject,
    useFactory: provider.useFactory,
  };
}

type ProviderRecord = {
  token: AnyDependencyToken;
  provider: NormalizedProvider;
  module: ModuleInstance;
};

type ModuleInstance = {
  moduleClass: ModuleClass;
  imports: ModuleInstance[];
  providers: Map<AnyDependencyToken, ProviderRecord>;
  exports: Set<AnyDependencyToken | ModuleClass>;
};

/**
 * The DI container. Holds all initialized provider instances and exposes them
 * for lookup by token.
 *
 * Create a container with `Container.create(RootModule)`. The static factory
 * is async because factory providers can return promises — all async work is
 * fully resolved before the returned promise settles.
 *
 * @example
 * const container = await Container.create(AppModule);
 * const service = container.get(UserService);
 * await container.dispose();
 *
 * // or with `await using` (TypeScript 5.2+):
 * await using container = await Container.create(AppModule);
 */
export class Container {
  private readonly modules = new Map<ModuleClass, ModuleInstance>();

  private readonly instances = new Map<ProviderRecord, unknown>();
  private readonly initializing = new Map<ProviderRecord, Promise<unknown>>();
  private readonly resolving = new Set<ProviderRecord>();

  private readonly root: ModuleInstance;

  private constructor(rootModule: ModuleClass) {
    this.root = this.compileModule(rootModule);
  }

  /**
   * Compiles the module graph rooted at `rootModule`, instantiates all
   * providers (running async factories concurrently where the dependency graph
   * allows), and calls `onModuleInit` lifecycle hooks in dependency order.
   *
   * Throws synchronously for structural errors (bad module, duplicate provider,
   * invalid export) and rejects for circular dependencies or failed async factories.
   */
  static async create(rootModule: ModuleClass): Promise<Container> {
    const container = new Container(rootModule);

    await container.initializeAllProviders();
    await container.callOnModuleInit();

    return container;
  }

  /**
   * Returns `true` if `token` is visible from the root module — either provided
   * locally or exported by an imported module.
   *
   * Useful for runtime checks before calling `get`, particularly in framework
   * adapters that need to detect whether a class token is a registered provider.
   */
  has(token: AnyDependencyToken): boolean {
    return this.findRecordFromModule(token, this.root) !== undefined;
  }

  /**
   * Returns the initialized instance for `token`. Fully type-safe: the return
   * type is inferred from the token.
   *
   * Throws `ProviderNotFoundError` if the token is not visible from the root
   * module, or if called after `dispose()`.
   */
  get<TToken extends AnyDependencyToken>(token: TToken): TokenValue<TToken> {
    const record = this.findRecordFromModule(token, this.root);

    if (!record) {
      throw new ProviderNotFoundError(formatToken(token), this.root.moduleClass.name);
    }

    if (!this.instances.has(record)) {
      throw new ProviderNotInitializedError(formatToken(token));
    }

    return this.instances.get(record) as TokenValue<TToken>;
  }

  /**
   * Iterates over every initialized provider as `[token, instance]` pairs.
   *
   * Used by `allTagged` and framework adapters like `registerControllers`.
   * The iteration order reflects the order providers were resolved.
   *
   * @example
   * for (const [token, instance] of container) {
   *   console.log(token, instance);
   * }
   */
  *[Symbol.iterator](): Generator<readonly [AnyDependencyToken, unknown]> {
    for (const [record, instance] of this.instances) {
      yield [record.token, instance] as const;
    }
  }

  private compileModule(moduleClass: ModuleClass): ModuleInstance {
    // Already compiled — return the cached instance (handles diamond imports).
    const existing = this.modules.get(moduleClass);

    if (existing) {
      return existing;
    }

    const metadata = getModuleMetadata(moduleClass);

    // Register the module before recursing so that circular module graphs
    // (if ever introduced) don't cause infinite recursion.
    const module: ModuleInstance = {
      moduleClass,
      imports: [],
      providers: new Map(),
      exports: new Set(metadata.exports ?? []),
    };

    this.modules.set(moduleClass, module);

    // Recursively compile each imported module. Order matters: imported modules
    // must be in this.modules before export validation checks for re-exports.
    for (const importedModuleClass of metadata.imports ?? []) {
      module.imports.push(this.compileModule(importedModuleClass));
    }

    // Register local providers. Duplicate tokens in the same module are caught here.
    for (const rawProvider of metadata.providers ?? []) {
      const provider = normalizeProvider(rawProvider);

      if (module.providers.has(provider.token)) {
        throw new DuplicateProviderError(formatToken(provider.token), moduleClass.name);
      }

      module.providers.set(provider.token, {
        token: provider.token,
        provider,
        module,
      });
    }

    // Validate exports: every exported entry must either be a locally provided
    // token or a module class that this module explicitly imports.
    for (const exportEntry of metadata.exports ?? []) {
      if (typeof exportEntry === "function" && this.modules.has(exportEntry)) {
        // Module re-export: the referenced module must be in our imports list.
        if (!module.imports.some((i) => i.moduleClass === exportEntry)) {
          throw new InvalidExportError(moduleClass.name, exportEntry.name, "is not imported");
        }
      } else {
        // Token export: must correspond to a local provider.
        const token = exportEntry as AnyDependencyToken;
        if (!module.providers.has(token)) {
          throw new InvalidExportError(moduleClass.name, formatToken(token), "has no such provider");
        }
      }
    }

    return module;
  }

  private async initializeAllProviders(): Promise<void> {
    const records = [...this.modules.values()].flatMap((module) => [
      ...module.providers.values(),
    ]);

    await Promise.all(records.map((record) => this.resolveRecord(record)));
  }

  private async resolveTokenFromModule(
    token: AnyDependencyToken,
    fromModule: ModuleInstance,
  ): Promise<unknown> {
    const record = this.findRecordFromModule(token, fromModule);

    if (!record) {
      throw new ProviderNotFoundError(formatToken(token), fromModule.moduleClass.name);
    }

    return await this.resolveRecord(record);
  }

  private async resolveDepArg(dep: AnyDepArg, fromModule: ModuleInstance): Promise<unknown> {
    if (isOptionalToken(dep)) {
      const record = this.findRecordFromModule(dep.token, fromModule);
      return record !== undefined ? await this.resolveRecord(record) : undefined;
    }
    return this.resolveTokenFromModule(dep, fromModule);
  }

  private findRecordFromModule(
    token: AnyDependencyToken,
    fromModule: ModuleInstance,
  ): ProviderRecord | undefined {
    const local = fromModule.providers.get(token);

    if (local) {
      return local;
    }

    for (const importedModule of fromModule.imports) {
      if (this.moduleExportsToken(importedModule, token)) {
        return this.findExportedRecordFromModule(token, importedModule);
      }
    }

    return undefined;
  }

  private findExportedRecordFromModule(
    token: AnyDependencyToken,
    exportedFromModule: ModuleInstance,
  ): ProviderRecord {
    const local = exportedFromModule.providers.get(token);

    if (local && exportedFromModule.exports.has(token)) {
      return local;
    }

    for (const importedModule of exportedFromModule.imports) {
      if (
        exportedFromModule.exports.has(importedModule.moduleClass) &&
        this.moduleExportsToken(importedModule, token)
      ) {
        return this.findExportedRecordFromModule(token, importedModule);
      }
    }

    // Only reachable if moduleExportsToken lied — should never happen.
    /* v8 ignore next 2 */
    throw new ProviderNotFoundError(formatToken(token), exportedFromModule.moduleClass.name);
  }

  private moduleExportsToken(
    module: ModuleInstance,
    token: AnyDependencyToken,
  ): boolean {
    if (module.exports.has(token)) {
      return true;
    }

    for (const exported of module.exports) {
      if (typeof exported !== "function") {
        continue;
      }

      const reExportedModule = this.modules.get(exported);

      if (!reExportedModule) {
        continue;
      }

      if (this.moduleExportsToken(reExportedModule, token)) {
        return true;
      }
    }

    return false;
  }

  private async resolveRecord(record: ProviderRecord): Promise<unknown> {
    /* v8 ignore next 3 */
    if (this.instances.has(record)) {
      return this.instances.get(record);
    }

    const existingInitialization = this.initializing.get(record);

    if (existingInitialization) {
      return await existingInitialization;
    }

    if (this.resolving.has(record)) {
      throw new CircularDependencyError(formatToken(record.token), record.module.moduleClass.name);
    }

    const initialization = this.initializeRecord(record);
    this.initializing.set(record, initialization);

    try {
      const instance = await initialization;
      this.instances.set(record, instance);
      return instance;
    } finally {
      this.initializing.delete(record);
    }
  }

  private async initializeRecord(record: ProviderRecord): Promise<unknown> {
    this.resolving.add(record);

    try {
      const instance = await this.instantiateRecord(record);
      return instance;
    } finally {
      this.resolving.delete(record);
    }
  }

  private async instantiateRecord(record: ProviderRecord): Promise<unknown> {
    const { provider, module } = record;

    switch (provider.kind) {
      case "value":
        return provider.useValue;
      case "factory": {
        const args = await Promise.all(
          provider.inject.map((dep) => this.resolveDepArg(dep, module)),
        );
        return provider.useFactory(...args); // async
      }
      case "class": {
        const deps = getInjectableDeps(provider.useClass);
        const args = await Promise.all(
          deps.map((dep) => this.resolveDepArg(dep, module)),
        );
        return new provider.useClass(...args);
      }
    }
  }

  private async callOnModuleInit(): Promise<void> {
    for (const [record, instance] of this.instances) {
      if (record.provider.kind !== "class") continue;
      const methodName = getOnModuleInitMethodName(record.provider.useClass);
      if (!methodName) continue;
      await (instance as any)[methodName]();
    }
  }

  private async callOnModuleDestroy(): Promise<void> {
    // Reverse of initialization order: dependents are torn down before their deps.
    const entries = [...this.instances.entries()].reverse();
    for (const [record, instance] of entries) {
      if (record.provider.kind !== "class") continue;
      const methodName = getOnModuleDestroyMethodName(record.provider.useClass);
      if (!methodName) continue;
      await (instance as any)[methodName]();
    }
  }

  /**
   * Runs all `@OnModuleDestroy` hooks in reverse dependency order, then clears
   * all internal state. Subsequent calls to `get` will throw `ProviderNotFoundError`.
   *
   * Also available as `[Symbol.asyncDispose]` for use with `await using`
   * (TypeScript 5.2+).
   *
   * @example
   * await container.dispose();
   *
   * // or with automatic cleanup:
   * await using container = await Container.create(AppModule);
   */
  async dispose(): Promise<void> {
    await this.callOnModuleDestroy();
    this.instances.clear();
    this.modules.clear();
  }

  /** Implements the `AsyncDisposable` protocol. Delegates to `dispose()`. */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose();
  }
}
