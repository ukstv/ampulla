# Lifecycle Hooks

Ampulla gives every class provider two optional lifecycle hooks: one called after all providers are initialized (`@OnModuleInit`), and one called when the container is disposed (`@OnModuleDestroy`). Both can be async.


## @OnModuleInit

Decorate a class with `@OnModuleInit()` to register an initialization hook. After all providers in the entire module graph have been instantiated, the container calls the designated method on each provider that has one, in **dependency order** — dependencies are initialized before the things that depend on them.

```ts
import { Injectable, OnModuleInit } from "ampulla";

@OnModuleInit()
@Injectable()
class DatabaseConnection {
  private connection: Connection | null = null;

  async onModuleInit() {
    this.connection = await openConnection("postgres://localhost/app");
    console.log("Database connected");
  }

  query(sql: string) {
    if (!this.connection) throw new Error("Not connected");
    return this.connection.query(sql);
  }
}
```

The method name defaults to `onModuleInit`. You can use any name:

```ts
@OnModuleInit("setup")
@Injectable()
class CacheService {
  async setup() {
    await this.warmUp();
  }
}
```

### Why this matters

Without lifecycle hooks, you would need to open connections and do startup work in the constructor. Constructors should be synchronous and free of side effects — they are called during provider instantiation, which runs in parallel. Lifecycle hooks run after everything is instantiated, in a safe, sequential, awaitable phase.


## @OnModuleDestroy

Decorate a class with `@OnModuleDestroy()` to register a teardown hook. When `container.dispose()` is called, the container invokes the designated method on each provider that has one, in **reverse dependency order** — dependents are torn down before their dependencies.

```ts
import { Injectable, OnModuleInit, OnModuleDestroy } from "ampulla";

@OnModuleDestroy()
@OnModuleInit()
@Injectable()
class DatabaseConnection {
  private connection: Connection | null = null;

  async onModuleInit() {
    this.connection = await openConnection("postgres://localhost/app");
  }

  async onModuleDestroy() {
    await this.connection?.close();
    this.connection = null;
    console.log("Database disconnected");
  }
}
```

Custom method name:

```ts
@OnModuleDestroy("teardown")
@Injectable()
class CacheService {
  async teardown() {
    await this.flush();
  }
}
```


## Initialization order

The container initializes providers in the order their dependencies require: a provider's `onModuleInit` hook runs only after all of its own dependencies have had their hooks called.

Given `A → B → C` (A depends on B, B depends on C):
1. `C.onModuleInit()`
2. `B.onModuleInit()`
3. `A.onModuleInit()`

Destruction runs in reverse:
1. `A.onModuleDestroy()`
2. `B.onModuleDestroy()`
3. `C.onModuleDestroy()`

This guarantees that when `A.onModuleInit` runs, it can safely call into `B` and `C` because they are fully initialized. Similarly, when `A.onModuleDestroy` runs, `B` and `C` are still live — `A` can cleanly finish its work before its dependencies are torn down.


## Disposing the container

Call `dispose()` when your application is shutting down:

```ts
const container = await Container.create(AppModule);

process.on("SIGTERM", async () => {
  await container.dispose();
  process.exit(0);
});
```

### await using

TypeScript 5.2+ supports the `await using` declaration, which calls `[Symbol.asyncDispose]()` automatically when the block exits. Ampulla's `Container` implements this protocol:

```ts
{
  await using container = await Container.create(AppModule);
  // use container...
} // container.dispose() is called here automatically
```

This is especially useful in tests:

```ts
it("creates a user", async () => {
  await using container = await Container.create(AppModule);
  const service = container.get(UserService);
  await service.create("Alice");
});
```


## Value and factory providers

Lifecycle hooks only apply to **class providers**. `useValue` and `useFactory` providers do not participate in `onModuleInit` or `onModuleDestroy`. If you need cleanup for a factory-provided resource, wrap it in a class with `@OnModuleDestroy`:

```ts
@OnModuleDestroy()
@Injectable(DB_POOL)
class DatabasePoolManager {
  private readonly pool: Pool;

  constructor(poolToken: Pool) {
    this.pool = poolToken;
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
```
