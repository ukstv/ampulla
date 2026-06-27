# ampulla

**Dependency injection with the ergonomics of NestJS. None of the framework.**

Ampulla gives you `@Module`, `@Injectable`, and a type-safe container — the DI model you already know — without pulling in a whole framework, `reflect-metadata` hacks, or TypeScript's legacy `experimentalDecorators` flag. It uses the modern JavaScript decorator syntax that ships in TypeScript 5+ with no extra configuration.

```ts
import { Container, Module, Injectable, injection, useValue } from "ampulla";

const DB_URL = injection<string>("DB_URL");

@Injectable(DB_URL)
class UserService {
  constructor(private readonly url: string) {}

  findAll() {
    return fetch(`${this.url}/users`).then((r) => r.json());
  }
}

@Module({
  providers: [
    useValue(DB_URL, "https://api.example.com"),
    UserService,
  ],
})
class AppModule {}

const container = await Container.create(AppModule);
const users = container.get(UserService);
```

That's the whole model. Declare dependencies with `@Injectable`, group them into `@Module`, bootstrap with `Container.create`. Everything else follows from these three ideas.


## Why ampulla

**No `reflect-metadata`.**
Most TypeScript DI libraries — including NestJS — rely on `emitDecoratorMetadata` and a `reflect-metadata` polyfill. This couples your DI wiring to TypeScript's private type-erasure behavior and requires a global side-effecting import. Ampulla uses the modern JavaScript decorator syntax that TypeScript 5+ supports natively, with no extra compiler flags and no polyfills. No surprises when TypeScript changes its metadata output.

**Just the container — and only what you import.**
Ampulla is not a framework. It has no HTTP server, no router, no opinion about how you structure your application. The Hono and H3 adapters live in separate entry points (`ampulla/hono`, `ampulla/h3`) and are fully tree-shakeable — if you don't import them, they don't exist in your bundle. More importantly, each adapter is written specifically for its framework: the Hono adapter speaks Hono's `Context` and extractors, the H3 adapter speaks H3's `H3Event`. There is no shared abstraction layer forcing them into the same shape — you get the full, native API of whichever framework you chose.

**Explicit dependencies are a feature.**
`@Injectable(TokenA, TokenB)` is the entire DI contract. TypeScript verifies that the constructor matches at compile time. There is no inference from constructor parameter types (which are erased at runtime anyway), no metadata scanning, no runtime surprises. What the decorator says is what the container injects.

**Module-scoped visibility.**
Providers are only visible where they are explicitly exported. No global singleton registry, no accidental cross-module access. The same module mental model as NestJS — imports, providers, exports — without the rest of the framework.

**Zero dependencies.**
Ampulla has no runtime dependencies. The Hono and H3 adapters reference their respective frameworks as type-only dependencies — the types are used at compile time, the runtime is whatever you already have.

**Testing is a first-class concern.**
`TestingContainer` composes a module inline for a single test, lets you override any provider, and returns a fully-initialized container in one line. No mock containers, no special test modes, no additional setup.


## Installation

Ampulla is published to both **npm** and **JSR**:

```sh
# npm / pnpm / yarn
npm install ampulla
pnpm add ampulla
yarn add ampulla

# JSR (Deno, or any package manager that supports JSR)
deno add jsr:@ukstv/ampulla
npx jsr add @ukstv/ampulla
```

Ampulla requires **TypeScript 5.2+**. No `experimentalDecorators`, no `reflect-metadata`, no Babel transforms needed.


## Five-minute tour

### 1. Declare your services

Use `@Injectable` to tell the container what a class needs. The arguments to `@Injectable` are the tokens — class constructors or opaque `InjectionToken` values — that the container will resolve and pass to the constructor.

```ts
import { Injectable } from "ampulla";

@Injectable()
class Logger {
  log(msg: string) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
  }
}

@Injectable(Logger)
class UserService {
  constructor(private readonly logger: Logger) {}

  create(name: string) {
    this.logger.log(`Creating user: ${name}`);
    // ...
  }
}
```

The TypeScript compiler verifies that `@Injectable(Logger)` matches the constructor signature. Forget a token, or pass the wrong type, and it's a compile error — not a runtime surprise.

### 2. Create an injection token for non-class values

Classes double as their own tokens. For everything else — strings, numbers, config objects, interfaces — create an explicit token with `injection<T>()`.

```ts
import { injection } from "ampulla";

export const CONFIG = injection<AppConfig>("CONFIG");
```

The string `"CONFIG"` is just a human-readable label for error messages. Token identity is determined by object reference, not by the string. Always `export` your tokens and `import` them wherever they are used — never recreate them with another `injection()` call.

### 3. Group providers into modules

A `@Module` declares which providers it owns and which it exposes to the outside world.

```ts
import { Module, useValue } from "ampulla";
import { CONFIG } from "./tokens.js";
import { UserService } from "./user.service.js";
import { Logger } from "./logger.js";

@Module({
  providers: [
    useValue(CONFIG, { maxUsers: 100 }),
    Logger,
    UserService,
  ],
  exports: [UserService],
})
export class UserModule {}
```

`exports` controls visibility. A module that imports `UserModule` can only see `UserService` — not `Logger` or `CONFIG`. This is how you build clean boundaries between parts of your application.

### 4. Compose modules into a root

```ts
import { Module } from "ampulla";
import { UserModule } from "./user.module.js";
import { DatabaseModule } from "./database.module.js";

@Module({
  imports: [DatabaseModule, UserModule],
})
class AppModule {}
```

Modules can be nested arbitrarily deep. The container resolves the full import graph and deduplicates shared modules automatically — if `UserModule` and `PostModule` both import `DatabaseModule`, a single `DatabaseService` instance is shared between them.

### 5. Bootstrap and use

```ts
import { Container } from "ampulla";

const container = await Container.create(AppModule);

const userService = container.get(UserService);
await userService.create("Alice");
```

`Container.create` is async because providers can have async factory functions. Everything is initialized before the promise resolves. `container.get` is synchronous after that.

### 6. Clean up

```ts
await container.dispose();

// Or use the `await using` syntax (requires TypeScript 5.2+):
await using container = await Container.create(AppModule);
// container.dispose() is called automatically at end of scope
```


## What's in the box

| Package | Contents |
|---|---|
| `ampulla` | `Container`, `Module`, `Injectable`, `injection`, `optional`, `useClass`, `useValue`, `useFactory`, `OnModuleInit`, `OnModuleDestroy` |
| `ampulla/tag` | `tag`, `Tagged`, `allTagged` |
| `ampulla/hono` | `Controller`, `Get/Post/Put/Patch/Delete`, `Extract`, `UseMiddleware`, `Header`, `registerControllers`, all extractors |
| `ampulla/h3` | Same API, adapted for H3 |
| `ampulla/testing` | `TestingContainer` |


## Documentation

- [Core Concepts](./docs/core-concepts.md) — `@Injectable`, `injection`, `@Module`, `Container`: how they work and how they relate to each other
- [Providers](./docs/providers.md) — `useClass`, `useValue`, `useFactory`: all three provider kinds and when to reach for each
- [Lifecycle Hooks](./docs/lifecycle.md) — `@OnModuleInit`, `@OnModuleDestroy`: initialization order, teardown, `await using`
- [Tags](./docs/tags.md) — `tag`, `@Tagged`, `allTagged`: grouping providers by role and querying them as a collection
- [Testing](./docs/testing.md) — `TestingContainer`: composing modules for tests, overriding providers, keeping tests fast
- [Hono Adapter](./docs/hono.md) — `@Controller`, `@Get`, `@Extract`, `@UseMiddleware`, `registerControllers`: full HTTP controller layer for Hono
- [H3 Adapter](./docs/h3.md) — same API, adapted for H3's `H3Event` and `H3Middleware`
- [Comparison](./docs/comparison.md) — how ampulla compares to NestJS, TypeDI, TSyringe, and InversifyJS
