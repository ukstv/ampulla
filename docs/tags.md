# Tags

Tags let you group providers by role and retrieve all instances sharing that role as a collection. The canonical use case: collecting all HTTP controllers, all event handlers, or all plugins without the collection needing to know what its members are called.


## Creating a tag

`tag<T>()` creates a new tag. The type parameter constrains what `allTagged` returns for this tag — use it to declare the shared interface every tagged provider implements.

```ts
import { tag } from "ampulla/tag";

export const HANDLER = tag<EventHandler>("handler");
export const CONTROLLER = tag<HttpController>("controller");
```

Like injection tokens, tags are matched by **object reference**. Two separately-created `tag("handler")` calls produce unrelated tags. Always export the tag constant and import it wherever it is used.


## @Tagged — marking a class

Apply `@Tagged` to a class to associate it with one or more tags. A class can carry multiple tags.

```ts
import { Injectable } from "ampulla";
import { Tagged } from "ampulla/tag";
import { HANDLER } from "./tags.js";

@Tagged(HANDLER)
@Injectable()
class UserCreatedHandler implements EventHandler {
  handle(event: UserCreatedEvent) { /* ... */ }
}

@Tagged(HANDLER)
@Injectable()
class UserDeletedHandler implements EventHandler {
  handle(event: UserDeletedEvent) { /* ... */ }
}
```

Providers tagged with `HANDLER` must also be listed in a module's `providers` array. The tag is metadata; it does not register the class with the container on its own.

```ts
@Module({
  providers: [UserCreatedHandler, UserDeletedHandler],
})
class EventModule {}
```


## allTagged — querying a collection

`allTagged(entries, tag)` scans an iterable of `[token, instance]` pairs and returns all instances whose class token carries the given tag.

`Container` implements `Symbol.iterator` over those pairs, so you can pass it directly:

```ts
import { allTagged } from "ampulla/tag";
import { HANDLER } from "./tags.js";

const container = await Container.create(AppModule);
const handlers = allTagged(container, HANDLER);

for (const handler of handlers) {
  eventBus.register(handler);
}
```

`allTagged` returns an array in container iteration order — the order providers were registered across all modules. Only class providers can carry tags; value and factory providers are automatically skipped.


## Complete example: plugin system

```ts
// plugin.ts
import { tag } from "ampulla/tag";

export interface Plugin {
  name: string;
  activate(): Promise<void>;
}

export const PLUGIN = tag<Plugin>("plugin");

// analytics.plugin.ts
import { Injectable } from "ampulla";
import { Tagged } from "ampulla/tag";
import { PLUGIN, type Plugin } from "./plugin.js";

@Tagged(PLUGIN)
@Injectable()
class AnalyticsPlugin implements Plugin {
  name = "analytics";
  async activate() { console.log("Analytics started"); }
}

// logging.plugin.ts
@Tagged(PLUGIN)
@Injectable()
class LoggingPlugin implements Plugin {
  name = "logging";
  async activate() { console.log("Logging started"); }
}

// app.module.ts
@Module({
  providers: [AnalyticsPlugin, LoggingPlugin],
})
class AppModule {}

// main.ts
const container = await Container.create(AppModule);
const plugins = allTagged(container, PLUGIN);

await Promise.all(plugins.map((p) => p.activate()));
// "Analytics started"
// "Logging started"
```

No `AppModule` needed — adding a new plugin is just adding a class with `@Tagged(PLUGIN)` and listing it in any module that's part of the graph. The startup code that calls `activate()` never changes.


## Tags and the hono adapter

The Hono adapter uses `@Tagged` internally to discover controllers. When you call `registerControllers(app, container)`, it uses `container`'s iterator to find all classes decorated with `@Controller`. You can use the same pattern for your own discovery needs.
