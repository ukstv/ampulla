# Comparison

Ampulla is not the only TypeScript DI container. Here is how it compares to the libraries you are most likely to have encountered: NestJS, TypeDI, TSyringe, and InversifyJS.

## At a glance

|                                        | ampulla | NestJS | TypeDI¹ | TSyringe | InversifyJS |
|----------------------------------------|:-------:|:------:|:-------:|:--------:|:-----------:|
| Works with vanilla `tsconfig.json` ²  | ✅      | ❌     | ❌      | ❌       | ❌          |
| No `reflect-metadata` polyfill ³      | ✅      | ❌     | ❌      | ❌       | ❌          |
| Module system with scoped exports      | ✅      | ✅     | ❌      | ❌       | ❌          |
| Type-safe injection tokens ⁴          | ✅      | ❌     | ✅ ¹    | ❌       | ✅           |
| Isolated per-app container             | ✅      | ✅     | ❌      | ❌       | ✅          |
| Framework-agnostic core                | ✅      | ❌     | ✅      | ✅       | ✅          |
| Async-safe bootstrap ⁵                | ✅      | ✅     | ❌      | ❌       | ⚠️          |
| Built-in testing utilities             | ✅      | ✅     | ❌      | ❌       | ❌          |
| Actively maintained                    | ✅      | ✅     | ❌      | ✅       | ✅          |

¹ TypeDI is no longer actively maintained.

² "Vanilla `tsconfig.json`" means no extra compiler flags. Every other library in this table requires both `experimentalDecorators: true` and `emitDecoratorMetadata: true` — two flags that enable TypeScript's legacy decorator system and instruct the compiler to emit hidden type metadata into the output JavaScript. Ampulla uses the decorator syntax that TypeScript 5+ supports out of the box, with neither flag. See [The `reflect-metadata` problem](#the-reflect-metadata-problem) below.

³ All other libraries here depend on `reflect-metadata` — a global polyfill for a proposal abandoned by the JavaScript standards body. TypeDI, TSyringe, and InversifyJS require you to import it manually; NestJS bundles the import itself. Either way, your TypeScript config must have `emitDecoratorMetadata: true` and your project carries an implicit runtime dependency on it.

⁴ Ampulla's `injection<T>("label")` returns an `InjectionToken<T>` — `container.get(MY_TOKEN)` returns the correct type with no annotation at the call site. InversifyJS achieves the same via `Symbol(...) as ServiceIdentifier<T>`. TypeDI has a comparable `Token<T>` class, but the library is no longer maintained. TSyringe and NestJS offer no typed non-class token mechanism — the type must be stated at every `container.resolve<T>()` or `moduleRef.get<T>()` call site.

⁵ Ampulla and NestJS await all async factories before the bootstrap promise resolves. `container.get()` is always synchronous — a service being available means it is fully initialized, regardless of whether its factory was sync or async. InversifyJS supports async factories but exposes the async work per-resolution via `container.getAsync()`; callers must track which providers are async. TSyringe and TypeDI have no async factory support.

## The `reflect-metadata` problem

NestJS, TypeDI, TSyringe, and InversifyJS all depend on `reflect-metadata` — a polyfill for a proposal that was ultimately abandoned by the JavaScript standards body. It works by reading TypeScript's `emitDecoratorMetadata` output: a side-channel that the TypeScript compiler adds to the emitted JavaScript describing the types of class constructor parameters.

This approach has several problems:

- **It requires a global side-effecting import** (TypeDI, TSyringe, InversifyJS). `import 'reflect-metadata'` must be the first import in your entry point, everywhere — tests, server, scripts — or things break in non-obvious ways. NestJS bundles this import itself, so you don't see it — but it is still there, and it still imposes the same constraints on your TypeScript configuration.
- **It depends on TypeScript's private emit format.** The metadata emitted for `constructor(private db: DatabaseService)` is a runtime artifact that TypeScript could change or remove. It is not part of the JavaScript language.
- **Types are erased anyway.** If `DatabaseService` is an abstract class or an interface, `reflect-metadata` cannot infer it — the emitted metadata is `Object`. You fall back to explicit tokens anyway.
- **It does not work with modern decorators.** TypeScript 5+ ships a new, standardized decorator implementation. `reflect-metadata` only works with the old `experimentalDecorators` system — the two are incompatible.

Ampulla sidesteps this entirely. `@Injectable(DatabaseService)` is explicit. The container never inspects types. There is nothing to break, nothing to polyfill, and nothing that depends on how TypeScript chooses to emit code.

## Async initialization

Consider a `DatabaseService` that opens a connection pool on startup. That connection step is async. Now consider a `CacheService` backed by an in-memory `Map` — no async work at all. From the perspective of every service that depends on either of them, this distinction should not matter. They just want a ready-to-use `DatabaseService` and a ready-to-use `CacheService`.

If the container exposes async initialization through the resolution API — a `getAsync()` method, or a factory that returns `Promise<T>` — it forces every caller to care. Code that today calls `container.get(DatabaseService)` must be rewritten to `await container.getAsync(DatabaseService)` if the service ever gains an async initialization step. Async is infectious in JavaScript: one `await` at the bottom propagates up every call chain until your entire application is scattered with awaits that have nothing to do with the service's actual behavior.

Ampulla and NestJS contain async initialization at bootstrap. You define an async factory with `useFactory`, and `Container.create()` awaits every async provider before it resolves. By the time you hold a container, every service is fully initialized:

```ts
const DB = injection<Database>('DB');

@Module({
  providers: [
    useFactory(DB, [], async () => {
      const db = new Database();
      await db.connect(); // awaited before Container.create() resolves
      return db;
    }),
    UserService,
  ],
})
class AppModule {}

const container = await Container.create(AppModule);
const users = container.get(UserService); // sync — db is already connected
```

`container.get()` is always synchronous after bootstrap. Whether a service's factory was async or not is an implementation detail invisible to its consumers. You can add a connection step to a service that previously had none and nothing outside that service's module needs to change.

InversifyJS supports async factories but surfaces the async work per-resolution: you call `container.getAsync<T>()` for async providers. The caller must know which providers are async and pick the right method at each call site — the implementation detail leaks.

TSyringe and TypeDI have no async factory support. If an initialization step is async, you handle it outside the container.

## vs NestJS

NestJS is the library ampulla is most inspired by. The module/provider/injectable mental model is identical. If you know NestJS DI, you already know ampulla.

The difference is that NestJS is a complete application framework — HTTP server, routing, pipes, guards, interceptors, WebSockets, microservices, GraphQL — and its DI container is inseparable from all of that. This works well when NestJS's opinions match your needs. When they don't, you feel it.

### Where NestJS gets in the way

**One abstraction over all HTTP frameworks.** NestJS can run on top of Express or Fastify, but it does so by wrapping both behind a common abstraction. The cost is that framework-specific features — Fastify's raw request/reply API, its schema-based validation, its hook system — are either unavailable or require reaching through the abstraction with `@Req()` / `@Res({ passthrough: true })`. You chose Fastify for a reason, and then NestJS partially takes it away.

Ampulla's HTTP adapters work differently. `ampulla/hono` is written for Hono: your handlers receive Hono's `Context`, extractors use `c.req`, middleware is `MiddlewareHandler`. `ampulla/h3` is written for H3: handlers receive `H3Event`, the entire H3 surface is available. There is no shared abstraction between them. Switching from one to the other means switching adapters, not fighting a leaky compatibility layer.

**One transport abstraction for all message sources.** Consider a realistic backend: an HTTP API that also reacts to events from a message broker like NATS. In NestJS, adding a second input source means reaching for its microservices system. That system comes with a fixed transport abstraction — NestJS ships a handful of built-in transports and you can write your own, but it is non-trivial. The NATS transport, for example, supports basic pub/sub but not JetStream. If you need JetStream, you are on your own to implement a custom transport, which is a significant undertaking just to receive messages.

The abstraction also leaks conceptually. NestJS expects every input handler — HTTP routes, NATS listeners, WebSocket gateways — to be decorated with `@Controller`. A class that listens for a `user.created` event from a message queue is not a controller in any meaningful sense of the word, but NestJS has no other primitive for "a class that handles incoming messages."

Worse, the surrounding machinery — `@UseGuards()`, `@UseInterceptors()`, `@UsePipes()` — was designed with HTTP in mind. What does a guard mean for a NATS message? What does intercepting a response mean when there is no response? NestJS applies these decorators across all transports, but the semantics only hold cleanly for HTTP. On other transports, you are using HTTP abstractions to model things that are not HTTP, and the mismatch quietly erodes the clarity of your code.

### How ampulla approaches the same problem

Ampulla has no opinion about input sources. The core is just a container. You wire up inputs yourself, using whatever libraries fit your needs.

For HTTP, the built-in Hono and H3 adapters handle everything — `@Controller`, route registration, middleware — with a single `registerControllers(app, container)` call. They live in separate entry points (`ampulla/hono`, `ampulla/h3`) so they are fully tree-shakeable: if you don't import them, they don't exist in your bundle.

For everything else, the tag system gives you the same kind of surgical wiring. You define a tag for your event handlers, annotate them with `@Tagged`, collect them from the container at startup, and attach them to their input source however that source actually works — full JetStream, manual acknowledgements, whatever you need.

```ts
import { tag, Tagged, allTagged } from 'ampulla/tag';
import { Controller, Get, registerControllers } from 'ampulla/hono';
import { Injectable, Module, Container } from 'ampulla';

// HTTP — handled by the built-in adapter, no manual wiring needed
@Controller('users')
@Injectable()
class UserController {
  @Get(':id')
  getUser(c: Context) { /* ... */ }
}

// NATS — your tag, your interface, your wiring
const EVENT_HANDLER = tag<NatsHandler>('event-handler');

@Tagged(EVENT_HANDLER)
@Injectable()
class UserCreatedHandler implements NatsHandler {
  subject = 'user.created';
  async handle(msg: NatsMsg) { /* JetStream, acknowledgements, whatever you need */ }
}

const container = await Container.create(AppModule);

// HTTP: one call, done
const app = new Hono();
registerControllers(app, container);

// NATS: you own the wiring — full JetStream, your way
const js = natsClient.jetstream();
for (const handler of allTagged(container, EVENT_HANDLER)) {
  const consumer = await js.consumers.get(handler.subject);
  const messages = await consumer.consume();
  for await (const msg of messages) {
    await handler.handle(msg);
    msg.ack();
  }
}
```

Each handler is called what it is. Each input source is wired the way that source actually works. Nothing is forced through a one-size-fits-all transport abstraction.

**NestJS also uses `reflect-metadata`.** Constructor parameter types are inferred automatically, which means the magic breaks silently when types are interfaces or abstract classes, and when `emitDecoratorMetadata` is off.

```ts
// NestJS
import { Injectable, Module } from '@nestjs/common';
// reflect-metadata is bundled by NestJS itself — no manual import needed,
// but emitDecoratorMetadata: true is still required in tsconfig.json

@Injectable()
class UserService {
  constructor(private db: DatabaseService) {} // type inferred via reflect-metadata
}

// ampulla
import { Injectable, Module } from 'ampulla';

@Injectable(DatabaseService) // explicit — no magic, no global import
class UserService {
  constructor(private db: DatabaseService) {}
}
```

**Choose NestJS** when you want a complete, opinionated backend framework with a rich ecosystem of official integrations (TypeORM, Passport, Bull, etc.) and your inputs fit the transports NestJS ships.

**Choose ampulla** when you need the same DI ergonomics but want to own how your application connects to the outside world — different input sources, custom protocols, environments where NestJS cannot run.

## vs TypeDI

> **Note:** TypeDI is no longer actively maintained. The repository has seen no meaningful activity in years. If you are starting a new project, this is worth factoring into the decision.

TypeDI is a lightweight DI container with a simple API. You decorate a class with `@Service()` and TypeDI auto-wires constructor parameters from their TypeScript types.

```ts
// TypeDI
import 'reflect-metadata';
import { Container, Service } from 'typedi';

@Service()
class Logger {}

@Service()
class UserService {
  constructor(private logger: Logger) {} // inferred via reflect-metadata
}

const svc = Container.get(UserService); // global container
```

The appeal is the minimal boilerplate. The cost is `reflect-metadata`, a global singleton `Container`, and no module system.

TypeDI's `Container` is not something you create — it is imported from the library itself, and it is the same object everywhere in your process. Every `@Service()` class anywhere in your codebase is automatically registered into that one registry the moment its module is imported. There is no isolation: `UserService` from your HTTP layer can freely depend on `InternalCacheService` from an unrelated module with nothing stopping it. In tests, providers registered in one test bleed into the next unless you manually call `Container.reset()`.

Ampulla's container is an instance you create: `await Container.create(AppModule)`. You can create as many as you need — one per test, two with different configurations, one for a background worker — and they are completely independent.

For primitives and interfaces, TypeDI falls back to `@Inject(() => Token)` syntax, making the "auto-wire" promise inconsistent in practice.

```ts
// TypeDI
import { injection } from 'ampulla';

export const DB_URL = injection<string>('DB_URL');

@Injectable(DB_URL) // same for all token types — consistent
class UserService {
  constructor(private url: string) {}
}
```

**Choose TypeDI** only if you are already using it in an existing project. For new projects, its unmaintained status makes it a risky foundation.

**Choose ampulla** when you need module boundaries, consistent token handling for all value types, or modern JavaScript decorators.

## vs TSyringe

TSyringe (by Microsoft) offers the most flexible provider system of the decorator-based libraries: `useClass`, `useValue`, `useFactory`, `useToken`, optional injection, `@injectAll` for arrays, child containers, and four lifetime scopes (transient, singleton, resolution-scoped, container-scoped).

```ts
// TSyringe
import 'reflect-metadata';
import { container, injectable, inject } from 'tsyringe';

@injectable()
class Logger {}

@injectable()
class UserService {
  constructor(
    private logger: Logger,       // class — inferred
    @inject('DB_URL') private url: string // primitive — must be explicit
  ) {}
}

container.register('DB_URL', { useValue: 'postgres://localhost/app' });
const svc = container.resolve(UserService);
```

Like TypeDI, TSyringe uses a global `container` imported from the library — the same shared registry for your whole process. Child containers let you create isolated sub-registries, but they inherit all registrations from their parent and there is no concept of "this provider is only visible to these consumers." It is scoping by convention, not enforcement.

The lifetime scopes are genuinely useful. If you need transient (new instance per resolution) or request-scoped providers, TSyringe supports them. Ampulla intentionally does not — all providers are singletons per container. If you need a new instance per request, create a new container per request.

**Choose TSyringe** when you need transient or request-scoped providers, optional dependencies, or array injection.

**Choose ampulla** when you need module-scoped visibility, modern JavaScript decorators, or a single consistent token API.

## vs InversifyJS

InversifyJS is the most explicit of the group. Like ampulla, it does not infer dependencies from TypeScript types — you use `@inject(Token)` on each constructor parameter. It supports class tokens, string tokens, and symbol tokens.

### Typed tokens

InversifyJS has `ServiceIdentifier<T>`, which enables type inference at `container.get()`. The recommended pattern is an `as` cast:

```ts
const LOGGER = Symbol('Logger') as ServiceIdentifier<Logger>;
const DB_URL  = Symbol('DB_URL')  as ServiceIdentifier<string>;

const url = container.get(DB_URL); // inferred as `string` ✓
```

One thing to note: InversifyJS's own documentation recommends `Symbol.for('key')` — a global symbol registry — rather than the `Symbol()` shown above. `Symbol.for('DB_URL')` in module A and `Symbol.for('DB_URL')` in module B return the **same** symbol, which can silently conflate unrelated tokens if two parts of a codebase happen to pick the same string.

Ampulla's `injection<T>()` returns an `InjectionToken<T>` — a plain object whose TypeScript type carries the generic directly. There is no cast, no global registry, and no way to accidentally conflate two tokens:

```ts
const DB_URL = injection<string>('DB_URL'); // InjectionToken<string> — inferred, not cast
export { DB_URL };
const url = container.get(DB_URL); // inferred as `string`
```

The string passed to `injection()` is only used in error messages. Identity is by object reference, so `injection<string>('DB_URL')` called twice produces two tokens that the container treats as unrelated — no global registry, no collision risk.

### Wiring: imperative binding vs declarative modules

The more significant difference is how you register providers. InversifyJS requires an explicit `.bind()` call for every provider:

```ts
// InversifyJS
import 'reflect-metadata';
import { Container, injectable, inject } from 'inversify';

const LOGGER: ServiceIdentifier<Logger> = Symbol.for('Logger');
const DB_URL: ServiceIdentifier<string> = Symbol.for('DB_URL');

@injectable()
class Logger {}

@injectable()
class UserService {
  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(DB_URL) private url: string,
  ) {}
}

const container = new Container();
container.bind(LOGGER).to(Logger);            // explicit bind for every provider
container.bind(DB_URL).toConstantValue('postgres://localhost/app');
container.bind(UserService).toSelf();         // and every class too

const svc = container.get(UserService);
```

Ampulla is declarative. You list providers in `@Module` and the container builds the dependency graph:

```ts
// ampulla — same explicitness, no reflect-metadata, no per-parameter decorators
const LOGGER = injection<Logger>('Logger');
const DB_URL = injection<string>('DB_URL');

@Injectable(LOGGER, DB_URL)
class UserService {
  constructor(private logger: Logger, private url: string) {}
}

@Module({
  providers: [
    useClass(LOGGER, ConsoleLogger),
    useValue(DB_URL, 'postgres://localhost/app'),
    UserService,
  ],
})
class AppModule {}

const container = await Container.create(AppModule); // graph resolved automatically
```

InversifyJS does support auto-wiring class dependencies via `container.resolve(ClassName)` for `@injectable()`-decorated classes, so you can skip some `bind().toSelf()` calls. But non-class tokens (strings, symbols, values) always require explicit binding. There is no module system — all bindings go into one container, and you manage organization yourself.

InversifyJS still requires `reflect-metadata` even though it does not use type inference — the library uses it for internal bookkeeping.

**Choose InversifyJS** if you need per-parameter metadata (tagged injection, named injection, multi-injection) or want an explicit imperative binding API.

**Choose ampulla** for declarative modules, a module visibility system, and no `reflect-metadata`.

## Summary

The choice comes down to two questions.

**Are you on TypeScript 5+ without `experimentalDecorators`?** If your project uses the modern decorator syntax — the default since TypeScript 5, no extra flags required — ampulla is the only decorator-based DI container that works.

**Do you need module boundaries?** If you want providers to be explicitly scoped — visible only to the modules that import them — ampulla and NestJS are your only options. Ampulla gives you that scoping without the rest of the NestJS framework.

If neither of those matters, TypeDI is the simplest choice for small projects, and TSyringe is the most flexible for larger ones.
