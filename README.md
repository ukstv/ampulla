# ampulla

> Type-safe dependency injection with the ergonomics of NestJS. None of the framework.

- **End-to-end type safety.** `container.get(MyService)` returns `MyService`, not `unknown`.
  Mismatched tokens are compile errors, not runtime crashes.
- **No `reflect-metadata`.** Uses TC39 Stage 3 decorators — no `experimentalDecorators`,
  no polyfills, no surprises when TypeScript changes its metadata output.
- **Zero dependencies.** Built-in [Hono](https://hono.dev) and [H3](https://h3.dev) adapters are type-only — the runtime is whatever you already have.
- **Tree-shakeable.** HTTP adapters live in separate entry points (`ampulla/hono`, `ampulla/h3`).
  If you don't import them, they don't exist in your bundle.
- **Module-scoped visibility.** No global singleton registry. Providers are only visible
  where explicitly exported — same mental model as NestJS, without the rest of the framework.
- **Testing built-in.** `TestingContainer` spins up a full container in one line,
  with any provider overrideable.

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
  providers: [useValue(DB_URL, "https://api.example.com"), UserService],
  exports: [UserService],
})
class AppModule {}

const container = await Container.create(AppModule);
const users = container.get(UserService); // typed as UserService
```

---

## Table of Contents

- [Install](#install)
- [Guide](#guide)
  - [Declaring services](#declaring-services)
  - [Injection tokens](#injection-tokens)
  - [Optional dependencies](#optional-dependencies)
  - [Modules](#modules)
  - [Providers](#providers)
  - [Bootstrapping](#bootstrapping)
  - [Lifecycle hooks](#lifecycle-hooks)
- [HTTP Adapters](#http-adapters)
  - [Hono](#hono)
  - [H3](#h3)
- [Testing](#testing)
- [Tags](#tags)
- [Documentation](#documentation)

---

## Install

```sh
npm install ampulla
```

Requires **TypeScript 5.2+** with no additional compiler flags.

---

## Guide

### Declaring services

`@Injectable` declares what a class needs. Its arguments are the tokens the container
resolves and passes to the constructor — in order.

```ts
import { Injectable } from "ampulla";

@Injectable()
class Logger {
  log(msg: string) { console.log(`[${new Date().toISOString()}] ${msg}`); }
}

@Injectable(Logger)
class UserService {
  constructor(private readonly logger: Logger) {}

  create(name: string) {
    this.logger.log(`Creating user: ${name}`);
  }
}
```

TypeScript verifies at compile time that `@Injectable(Logger)` matches the constructor
signature. Forget a token, pass the wrong type, or misorder them — it's a type error.

### Injection tokens

Classes double as their own tokens. For everything else — strings, numbers, config objects,
interfaces — create an explicit typed token with `injection<T>()`.

```ts
import { injection } from "ampulla";

export const DB_URL = injection<string>("DB_URL");
export const CONFIG  = injection<AppConfig>("CONFIG");
```

The string label is only used in error messages. Token identity is **object reference** —
always export and import the same constant, never recreate it.

### Optional dependencies

Wrap a token with `optional()` to inject `undefined` when the provider is absent
instead of throwing.

```ts
import { Injectable, injection, optional } from "ampulla";

const CACHE = injection<Cache>("CACHE");

@Injectable(DB_URL, optional(CACHE))
class UserService {
  constructor(private url: string, private cache?: Cache) {}
}
```

### Modules

A `@Module` declares which providers it owns (`providers`) and which it exposes
to importers (`exports`).

```ts
import { Module, useValue } from "ampulla";

@Module({
  providers: [useValue(DB_URL, "postgres://localhost/app"), Logger, UserService],
  exports: [UserService],
})
class UserModule {}
```

Modules compose — importers can only see what is explicitly exported:

```ts
@Module({
  imports: [DatabaseModule, UserModule],
  providers: [AppService],
})
class AppModule {}
```

The container deduplicates shared modules automatically. If `UserModule` and `PostModule`
both import `DatabaseModule`, a single `DatabaseService` instance is shared between them.

### Providers

Three provider shapes beyond bare class constructors:

```ts
import { useValue, useClass, useFactory } from "ampulla";

useValue(PORT, 3000)                                      // pre-existing value
useClass(LoggerDep, ConsoleLogger)                        // concrete under abstract token
useFactory(DB, [DB_URL], async url => new Pool(url))      // async factory
```

Factory providers may return a `Promise` — the container awaits all factories concurrently
before making any value available.

### Bootstrapping — sync and async

`Container.create` awaits every async factory before resolving. By the time you
have a container, every provider is fully initialized and ready — no deferred
initialization, no "is it ready yet?" checks.

```ts
import { Container, Module, useFactory, injection } from "ampulla";

const DB_URL = injection<string>("DB_URL");
const DB = injection<Pool>("DB");

// Async factory: the container waits for the connection before proceeding.
// Independent async factories run concurrently.
const dbProvider = useFactory(DB, [DB_URL], async (url) => {
  const pool = new Pool(url);
  await pool.connect();   // fully connected by the time any consumer gets it
  return pool;
});

@Module({ providers: [useValue(DB_URL, "postgres://localhost/app"), dbProvider, UserService] })
class AppModule {}

const container = await Container.create(AppModule);

// At this point every provider — including the async DB pool — is ready.
const users = container.get(UserService); // synchronous, fully typed
```

### Lifecycle hooks

Async factories initialize a provider *in isolation*. Lifecycle hooks fire *after every
provider in the graph is ready*, which is the right place for cross-service coordination.

- `@OnModuleInit` — runs after all providers are instantiated, in dependency order.
  Use it to warm caches from a ready DB, subscribe to another service's events,
  register with a central bus, or start scheduled jobs once all dependencies are live.
- `@OnModuleDestroy` — runs on `dispose()`, in reverse order (dependents first, deps last).
  Use it to flush queues before closing connections, finish in-flight work, or
  deregister from service discovery.

**Rule of thumb:** factories own *"am I ready"*, lifecycle hooks own *"now that everyone
else is ready, coordinate"*.

```ts
import { Injectable, OnModuleInit, OnModuleDestroy } from "ampulla";

@OnModuleInit()
@OnModuleDestroy()
@Injectable(DB, EventBus)
class UserRepository {
  constructor(private db: Pool, private bus: EventBus) {}

  async onModuleInit() {
    // DB and EventBus are both fully ready here — safe to query and subscribe
    const count = await this.db.query("SELECT COUNT(*) FROM users");
    this.bus.emit("users:ready", { count });
  }

  async onModuleDestroy() {
    // EventBus is still up — dependents are torn down first
    this.bus.emit("users:shutdown");
  }
}
```

Use `await using` for automatic cleanup (TypeScript 5.2+):

```ts
await using container = await Container.create(AppModule);
// container.dispose() is called automatically at end of scope
```

---

## HTTP Adapters

HTTP is the most common entry point, so ampulla ships adapters for [Hono](https://hono.dev)
and [H3](https://h3.dev) out of the box. But the container is just a container — nothing
stops you from wiring it to WebSockets, message queues, cron jobs, or any other input
source. `container.get(MyService)` works the same regardless of what calls it.

### Hono

```ts
import { Hono } from "hono";
import { Controller, Get, Extract, query, registerControllers } from "ampulla/hono";

@Controller("users")
@Injectable()
class UserController {
  @Extract({ name: query("name") })
  @Get("search")
  search(params: { name: string | undefined }) {
    return new Response(params.name ?? "");
  }
}

@Module({ providers: [UserController] })
class AppModule {}

const app = new Hono();
const container = await Container.create(AppModule);
registerControllers(app, container);
export default app;
```

See [Hono adapter docs](./docs/hono.md) for the full extractor and middleware API.

### H3

Controllers, extractors, and middleware — same decorator API, adapted for H3's `H3Event`:

```ts
import { H3 } from "h3";
import { Controller, Get, Extract, query, registerControllers } from "ampulla/h3";
```

See [H3 adapter docs](./docs/h3.md).

---

## Testing

`TestingContainer` creates a one-off module inline — no class declarations needed:

```ts
import { TestingContainer } from "ampulla/testing";
import { useValue } from "ampulla";

const svc = await TestingContainer.use(UserService, {
  providers: [useValue(DB_URL, "postgres://localhost/test"), UserService],
});

expect(svc.findAll()).toEqual([]);
```

For tests that need to inspect multiple providers:

```ts
const container = await TestingContainer.fromModule({
  providers: [useValue(DB_URL, "postgres://test"), Logger, UserService],
});

const logger = container.get(Logger);
const users  = container.get(UserService);
```

---

## Tags

`container.get` retrieves a single known provider by token. But some patterns need
a collection — all event handlers, all controllers, all plugins — where the consumer
shouldn't have to know what's registered. Tags solve this: mark providers with a shared
role, then retrieve every instance that carries it in one call, without any direct
dependency between them. This is exactly the mechanism `registerControllers` uses
internally — it collects all tagged controller instances and mounts them onto the
Hono or H3 app.

```ts
import { tag, Tagged, allTagged } from "ampulla/tag";

const HANDLER = tag<{ handle(): void }>("handler");

@Tagged(HANDLER)
@Injectable()
class FooHandler { handle() { /* ... */ } }

const handlers = allTagged(container, HANDLER); // FooHandler[]
handlers.forEach(h => h.handle());
```

---

## Documentation

- [Core Concepts](./docs/core-concepts.md) — `@Injectable`, `injection`, `@Module`, `Container`
- [Providers](./docs/providers.md) — `useClass`, `useValue`, `useFactory`
- [Lifecycle Hooks](./docs/lifecycle.md) — `@OnModuleInit`, `@OnModuleDestroy`, `await using`
- [Tags](./docs/tags.md) — `tag`, `@Tagged`, `allTagged`
- [Testing](./docs/testing.md) — `TestingContainer`
- [Hono Adapter](./docs/hono.md) — controllers, extractors, middleware for Hono
- [H3 Adapter](./docs/h3.md) — same API for H3
- [Comparison](./docs/comparison.md) — vs NestJS, TypeDI, TSyringe, InversifyJS
