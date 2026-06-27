# Core Concepts

Ampulla is built on three ideas: **`@Injectable`** declares what a class needs, **`@Module`** groups related providers and controls what they expose, and **`Container`** wires everything together. Understanding how these three interact is all you need to use the library effectively.


## @Injectable — declaring dependencies

`@Injectable` is a class decorator that tells the container what to inject into the constructor. Its arguments are the **dependency tokens** — the exact same values you registered as providers — that will be resolved and passed as constructor arguments, in order.

```ts
import { Injectable } from "ampulla";

@Injectable()
class Logger {
  log(msg: string) { console.log(msg); }
}

@Injectable(Logger)
class UserService {
  constructor(private readonly logger: Logger) {}
}
```

**The decorator arguments are the sole source of DI information.** TypeScript constructor parameter types are erased at runtime. The container never reads them. If you write a constructor that accepts `Logger` but forget to pass `Logger` to `@Injectable`, the container will call `new UserService()` with no arguments and `this.logger` will be `undefined`.

The TypeScript compiler will catch this for you: `@Injectable()` constrains the class to be constructable with exactly the argument types the tokens produce. A mismatch is a compile error. This is by design — explicit over implicit, caught early.


## optional — marking a dependency as optional

Wrap any token with `optional()` to tell the container: if this provider is not registered, inject `undefined` instead of throwing.

```ts
import { Injectable, injection, optional } from "ampulla";

const CONFIG = injection<AppConfig>("CONFIG");

@Injectable(Logger, optional(CONFIG))
class UserService {
  constructor(
    private readonly logger: Logger,
    private readonly config?: AppConfig,
  ) {}
}
```

The TypeScript compiler enforces the contract: because the token is wrapped in `optional()`, the corresponding constructor parameter must be typed as `T | undefined`. Forgetting the `?` is a compile error.

If the provider is registered, it behaves identically to a required dependency — the resolved value is injected as normal. If it is not registered, `undefined` is passed and no error is thrown.

You can wrap a token at the point of use, or wrap it once at the declaration site and reuse the wrapped token everywhere:

```ts
// tokens.ts
export const CONFIG = injection<AppConfig>("CONFIG");
export const OPTIONAL_CONFIG = optional(CONFIG);

// service.ts
@Injectable(Logger, OPTIONAL_CONFIG)
class UserService {
  constructor(private logger: Logger, private config?: AppConfig) {}
}
```

`optional()` works with class tokens, `InjectionToken` values, and inside `useFactory`'s inject array.


## injection — tokens for non-class values

Class constructors double as their own tokens. For everything else — strings, numbers, configuration objects, interface implementations — use `injection<T>()` to create an explicit token.

```ts
import { injection } from "ampulla";

export const DB_URL = injection<string>("DB_URL");
export const CONFIG = injection<AppConfig>("CONFIG");
```

The string argument is a **human-readable label** used only in error messages. It has no effect on identity or lookup. Tokens are matched by **object reference**:

```ts
const TOKEN_A = injection<string>("FOO");
const TOKEN_B = injection<string>("FOO");

// TOKEN_A and TOKEN_B are completely unrelated.
// Same label, different identity.
```

This prevents accidental collisions between modules that happen to use the same string. It also means: **always export your tokens and import them** — never recreate them with a second `injection()` call. A recreated token will not match any registered provider.

```ts
// tokens.ts — the single source of truth
export const DB_URL = injection<string>("DB_URL");

// service.ts
import { DB_URL } from "./tokens.js";

@Injectable(DB_URL)
class UserService {
  constructor(private readonly url: string) {}
}

// module.ts
import { DB_URL } from "./tokens.js";  // same reference

@Module({
  providers: [useValue(DB_URL, "postgres://localhost/app"), UserService],
})
class AppModule {}
```


## @Module — grouping and visibility

A module declares the providers it owns (`providers`), the modules it depends on (`imports`), and what it makes available to its importers (`exports`).

```ts
import { Module, useValue } from "ampulla";

@Module({
  imports: [DatabaseModule],
  providers: [Logger, UserService],
  exports: [UserService],
})
class UserModule {}
```

**Visibility is explicit.** A module that imports `UserModule` can access `UserService` because it is exported. It cannot access `Logger` because that stays private to `UserModule`. It can access anything that `DatabaseModule` exports (and that `UserModule` re-exports by including `DatabaseModule` in its own `exports`).

This is not just a convention — the container enforces it at startup. Attempting to inject an unexported provider from another module throws a `ProviderNotFoundError` before your application ever serves a request.

### Provider forms

The `providers` array accepts four forms:

```ts
@Module({
  providers: [
    // 1. Bare class — provides itself as the token
    UserService,

    // 2. useClass — provides a different token for the same class
    useClass(IUserService, UserService),

    // 3. useValue — provides a fixed value for a token
    useValue(CONFIG, { port: 3000 }),

    // 4. useFactory — provides the return value of a function
    useFactory(DB_URL, [CONFIG], (config) => `postgres://localhost/${config.db}`),
  ],
})
class AppModule {}
```

See [Providers](./providers.md) for details on each form.

### Module re-exports

A module can re-export an imported module, making all of that module's exports transitively visible to its own importers:

```ts
@Module({
  imports: [DatabaseModule],
  exports: [DatabaseModule],  // re-export the whole module
})
class InfrastructureModule {}
```

Any module that imports `InfrastructureModule` will see everything `DatabaseModule` exported, without needing to import `DatabaseModule` directly.

### Diamond imports

When two modules both import the same module, the container deduplicates it. Shared modules are compiled and instantiated once; their providers are shared instances, not copies.

```ts
@Module({ providers: [Cache], exports: [Cache] })
class CacheModule {}

@Module({ imports: [CacheModule], exports: [CacheModule] })
class UserModule {}

@Module({ imports: [CacheModule], exports: [CacheModule] })
class PostModule {}

@Module({ imports: [UserModule, PostModule] })
class AppModule {}
// Cache is instantiated once and shared by UserModule and PostModule.
```


## Container — bootstrapping and access

`Container.create(RootModule)` compiles the module graph, instantiates all providers (in parallel where possible), runs lifecycle init hooks, and returns a fully-initialized container.

```ts
import { Container } from "ampulla";

const container = await Container.create(AppModule);
```

It is async because factory providers can return promises. All async work is fully resolved before the container is returned. Subsequent `container.get()` calls are synchronous.

```ts
const service = container.get(UserService);
const url = container.get(DB_URL);
```

`container.get` accepts any token — a class constructor or an `InjectionToken` — and returns the corresponding instance with full type inference. If the token is not found, it throws `ProviderNotFoundError`.

### Provider scope

Each provider is instantiated exactly once per container. `container.get(UserService)` always returns the same instance. There are no request-scoped or transient providers; all providers are singletons for the lifetime of the container.

### Dependency scope

A provider's dependencies are resolved in the **context of the module that defines it**, not the module that imports it. This means a provider's behavior is determined by where it lives, not by who uses it.

```ts
const LABEL = injection<string>("LABEL");

@Injectable(LABEL)
class TaggedService {
  constructor(readonly label: string) {}
}

@Module({
  providers: [useValue(LABEL, "from-service-module"), TaggedService],
  exports: [TaggedService],
})
class ServiceModule {}

@Module({
  imports: [ServiceModule],
  providers: [useValue(LABEL, "from-app-module")],  // this has no effect on TaggedService
})
class AppModule {}

// TaggedService.label === "from-service-module"
```

### Iterating the container

`Container` is iterable. It yields `[token, instance]` pairs for every initialized provider.

```ts
for (const [token, instance] of container) {
  console.log(token, instance);
}
```

This is primarily used by `allTagged` (see [Tags](./tags.md)) and by framework adapters like `registerControllers`.

### Disposal

Call `container.dispose()` to run all `@OnModuleDestroy` hooks and clear internal state. Alternatively, use the `await using` declaration (TypeScript 5.2+):

```ts
await using container = await Container.create(AppModule);
// dispose() is called automatically when the block exits
```


## Error reference

| Error | When it's thrown |
|---|---|
| `NotAModuleError` | `Container.create()` receives a class without `@Module` |
| `InvalidProviderError` | A bare `InjectionToken` appears in `providers` |
| `ProviderNotFoundError` | The container cannot find a provider for a token |
| `ProviderNotInitializedError` | `container.get()` is called on a registered token whose instance is missing (e.g. after `dispose()`) |
| `DuplicateProviderError` | The same token is registered twice in one module |
| `InvalidExportError` | A module exports a token it doesn't provide, or a module it doesn't import |
| `CircularDependencyError` | A circular dependency is detected during resolution |
