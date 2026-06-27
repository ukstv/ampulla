import { describe, it, expect } from "vitest";
import {
  Container,
  Module,
  Injectable,
  injection,
  optional,
  useValue,
  useClass,
  useFactory,
  NotAModuleError,
  InvalidProviderError,
  ProviderNotFoundError,
  DuplicateProviderError,
  CircularDependencyError,
} from "../index.js";
import { K_MODULE_METADATA } from "../module.js";

describe("provider resolution", () => {
  describe("class provider", () => {
    it("no dependencies", async () => {
      @Injectable()
      class MyService {}

      @Module({ providers: [MyService] })
      class AppModule {}

      const container = await Container.create(AppModule);
      expect(container.get(MyService)).toBeInstanceOf(MyService);
    });

    it("class-token dependency", async () => {
      @Injectable()
      class Dep {}

      @Injectable(Dep)
      class MyService {
        constructor(public readonly dep: Dep) {}
      }

      @Module({ providers: [Dep, MyService] })
      class AppModule {}

      const container = await Container.create(AppModule);
      const service = container.get(MyService);
      expect(service.dep).toBeInstanceOf(Dep);
    });

    it("constructor parameter types are not injected — only @Injectable() args are", async () => {
      @Injectable()
      class Dep {}

      // @ts-expect-error — TypeScript correctly rejects @Injectable() here because
      // the decorator constrains the class to be constructable with no arguments,
      // but the constructor requires `dep: Dep`. At runtime the container still
      // calls `new MyService()` with no args, so dep receives undefined.
      @Injectable()
      class MyService {
        constructor(public readonly dep: Dep) {}
      }

      @Module({ providers: [Dep, MyService] })
      class AppModule {}

      const container = await Container.create(AppModule);
      expect(container.get(MyService).dep).toBeUndefined();
    });

    it("InjectionToken dependency", async () => {
      const VALUE = injection<number>("VALUE");

      @Injectable(VALUE)
      class MyService {
        constructor(public readonly value: number) {}
      }

      @Module({ providers: [useValue(VALUE, 42), MyService] })
      class AppModule {}

      const container = await Container.create(AppModule);
      expect(container.get(MyService).value).toBe(42);
    });

    it("interface-based dependency via injection token", async () => {
      interface Logger {
        log(msg: string): void;
        messages: string[];
      }

      const LOGGER = injection<Logger>("Logger");

      @Injectable(LOGGER)
      class App {
        constructor(public readonly logger: Logger) {}

        run() {
          this.logger.log("started");
        }
      }

      const messages: string[] = [];
      const fakeLogger: Logger = {
        messages,
        log(msg) {
          messages.push(msg);
        },
      };

      @Module({ providers: [useValue(LOGGER, fakeLogger), App] })
      class AppModule {}

      const container = await Container.create(AppModule);
      const app = container.get(App);
      app.run();

      expect(app.logger).toBe(fakeLogger);
      expect(messages).toEqual(["started"]);
    });

    it("useClass maps a token to a different class", async () => {
      abstract class Repo {
        abstract find(): string[];
      }

      @Injectable()
      class FakeRepo extends Repo {
        find() {
          return ["a", "b"];
        }
      }

      @Module({ providers: [useClass(Repo, FakeRepo)] })
      class AppModule {}

      const container = await Container.create(AppModule);
      expect(container.get(Repo)).toBeInstanceOf(FakeRepo);
      expect(container.get(Repo).find()).toEqual(["a", "b"]);
    });

    it("class provider without @Injectable decorator is treated as zero-dep", async () => {
      // No @Injectable — getInjectableDeps falls back to []
      class Service {}

      @Module({ providers: [Service] })
      class AppModule {}

      const container = await Container.create(AppModule);
      expect(container.get(Service)).toBeInstanceOf(Service);
    });

    it("useClass implementation class with deps receives them", async () => {
      const PREFIX = injection<string>("PREFIX");

      abstract class Formatter {
        abstract format(s: string): string;
      }

      @Injectable(PREFIX)
      class PrefixFormatter extends Formatter {
        constructor(private prefix: string) {
          super();
        }
        format(s: string) {
          return `${this.prefix}:${s}`;
        }
      }

      @Module({
        providers: [
          useValue(PREFIX, "log"),
          useClass(Formatter, PrefixFormatter),
        ],
      })
      class AppModule {}

      const container = await Container.create(AppModule);
      expect(container.get(Formatter).format("hello")).toBe("log:hello");
    });
  });

  describe("token identity", () => {
    it("two injection() calls with the same key are distinct tokens", async () => {
      const A = injection<string>("FOO");
      const B = injection<string>("FOO");

      @Module({ providers: [useValue(A, "from-A"), useValue(B, "from-B")] })
      class AppModule {}

      const container = await Container.create(AppModule);
      expect(container.get(A)).toBe("from-A");
      expect(container.get(B)).toBe("from-B");
    });

    it("only the original token reference resolves — a recreated token misses", async () => {
      const REAL = injection<string>("SECRET");

      @Module({ providers: [useValue(REAL, "value")] })
      class AppModule {}

      const container = await Container.create(AppModule);
      const IMPOSTOR = injection<string>("SECRET");
      expect(() => container.get(IMPOSTOR)).toThrow(/SECRET/);
    });
  });

  describe("value provider", () => {
    it("returns the exact primitive", async () => {
      const TOKEN = injection<number>("PORT");

      @Module({ providers: [useValue(TOKEN, 3000)] })
      class AppModule {}

      const container = await Container.create(AppModule);
      expect(container.get(TOKEN)).toBe(3000);
    });

    it("returns the exact object reference", async () => {
      const TOKEN = injection<object>("OBJ");
      const obj = { x: 1 };

      @Module({ providers: [useValue(TOKEN, obj)] })
      class AppModule {}

      const container = await Container.create(AppModule);
      expect(container.get(TOKEN)).toBe(obj);
    });
  });

  describe("factory provider", () => {
    it("sync factory with no deps", async () => {
      const TOKEN = injection<number>("N");

      @Module({ providers: [useFactory(TOKEN, [], () => 42)] })
      class AppModule {}

      const container = await Container.create(AppModule);
      expect(container.get(TOKEN)).toBe(42);
    });

    it("async factory is awaited before container resolves", async () => {
      const TOKEN = injection<string>("S");
      const steps: Array<string> = [];

      @Module({
        providers: [
          useFactory(TOKEN, [], async () => {
            steps.push("factory:start");
            await Promise.resolve();
            steps.push("factory:end");
            return "async-value";
          }),
        ],
      })
      class AppModule {}

      steps.push("create:start");
      const container = await Container.create(AppModule);
      steps.push("create:end");

      expect(steps).toEqual([
        "create:start",
        "factory:start",
        "factory:end",
        "create:end",
      ]);
      expect(container.get(TOKEN)).toBe("async-value");
    });

    it("receives resolved deps as arguments", async () => {
      const A = injection<number>("A");
      const B = injection<number>("B");
      const C = injection<number>("C");

      @Module({
        providers: [
          useValue(A, 2),
          useValue(B, 3),
          useFactory(C, [A, B], (a, b) => a * b),
        ],
      })
      class AppModule {}

      const container = await Container.create(AppModule);
      expect(container.get(C)).toBe(6);
    });

    it("deps are fully resolved before the dependent factory runs", async () => {
      const A = injection<string>("A");
      const B = injection<string>("B");
      const C = injection<string>("C");
      const steps: Array<string> = [];

      @Module({
        providers: [
          useFactory(A, [], async () => {
            steps.push("A:start");
            await Promise.resolve();
            steps.push("A:end");
            return "a";
          }),
          useFactory(B, [], async () => {
            steps.push("B:start");
            await Promise.resolve();
            steps.push("B:end");
            return "b";
          }),
          useFactory(C, [A, B], async (a, b) => {
            steps.push("C:start");
            await Promise.resolve();
            steps.push("C:end");
            return `${a}+${b}`;
          }),
        ],
      })
      class AppModule {}

      const container = await Container.create(AppModule);

      // A and B are resolved in parallel (both start before either ends),
      // then C starts only after both are done.
      expect(steps).toEqual([
        "A:start",
        "B:start",
        "A:end",
        "B:end",
        "C:start",
        "C:end",
      ]);
      expect(container.get(C)).toBe("a+b");
    });

    it("async factory with deps", async () => {
      const URL = injection<string>("URL");
      const CONN = injection<string>("CONN");
      const steps: Array<string> = [];

      @Module({
        providers: [
          useValue(URL, "postgres://localhost"),
          useFactory(CONN, [URL], async (url) => {
            steps.push("CONN:start");
            await Promise.resolve();
            steps.push("CONN:end");
            return `connected:${url}`;
          }),
        ],
      })
      class AppModule {}

      steps.push("create:start");
      const container = await Container.create(AppModule);
      steps.push("create:end");

      expect(steps).toEqual([
        "create:start",
        "CONN:start",
        "CONN:end",
        "create:end",
      ]);
      expect(container.get(CONN)).toBe("connected:postgres://localhost");
    });
  });

  describe("errors", () => {
    it("throws when a class dep is not registered", async () => {
      @Injectable()
      class Missing {}

      @Injectable(Missing)
      class MyService {
        constructor(public readonly dep: Missing) {}
      }

      @Module({ providers: [MyService] })
      class AppModule {}

      await expect(Container.create(AppModule)).rejects.toThrow(ProviderNotFoundError);
    });

    it("throws when an InjectionToken dep is not registered", async () => {
      const MISSING = injection<string>("MISSING");

      @Injectable(MISSING)
      class MyService {
        constructor(public readonly value: string) {}
      }

      @Module({ providers: [MyService] })
      class AppModule {}

      await expect(Container.create(AppModule)).rejects.toThrow(ProviderNotFoundError);
      await expect(Container.create(AppModule)).rejects.toThrow(/MISSING/);
    });

    it("error message names the missing token", async () => {
      const DB_URL = injection<string>("DB_URL");

      @Injectable(DB_URL)
      class MyService {
        constructor(public readonly url: string) {}
      }

      @Module({ providers: [MyService] })
      class AppModule {}

      await expect(Container.create(AppModule)).rejects.toThrow(ProviderNotFoundError);
      await expect(Container.create(AppModule)).rejects.toThrow("DB_URL");
    });

    it("throws on duplicate token in the same module", async () => {
      const TOKEN = injection<number>("TOKEN");

      @Module({ providers: [useValue(TOKEN, 1), useValue(TOKEN, 2)] })
      class AppModule {}

      await expect(Container.create(AppModule)).rejects.toThrow(DuplicateProviderError);
      await expect(Container.create(AppModule)).rejects.toThrow(/TOKEN/);
    });

    it("throws when get() is called with an unregistered token", async () => {
      @Module({ providers: [] })
      class AppModule {}

      const container = await Container.create(AppModule);
      const UNKNOWN = injection<string>("UNKNOWN");

      expect(() => container.get(UNKNOWN)).toThrow(ProviderNotFoundError);
      expect(() => container.get(UNKNOWN)).toThrow(/UNKNOWN/);
    });

    it("throws when an InjectionToken is passed directly as a provider", async () => {
      const TOKEN = injection<string>("TOKEN");

      // @ts-expect-error — InjectionToken cannot be used as a provider directly
      @Module({ providers: [TOKEN] })
      class AppModule {}

      await expect(Container.create(AppModule)).rejects.toThrow(InvalidProviderError);
      await expect(Container.create(AppModule)).rejects.toThrow(/TOKEN/);
    });

    it("throws when Container.create() is called with a non-module class", async () => {
      class NotAModule {}

      await expect(Container.create(NotAModule as any)).rejects.toThrow(NotAModuleError);
      await expect(Container.create(NotAModule as any)).rejects.toThrow(/NotAModule/);
    });

    it("throws when K_MODULE_METADATA is present but falsy", async () => {
      class BadModule {}
      Object.defineProperty(BadModule, K_MODULE_METADATA, { value: null });

      await expect(Container.create(BadModule as any)).rejects.toThrow(NotAModuleError);
    });

    it("throws on circular dependency", async () => {
      // @Injectable() deps are the DI declaration — constructor type annotations are not.
      // Use factory providers to express A → B → A without forward-reference issues.
      const A = injection<object>("A");
      const B = injection<object>("B");

      @Module({
        providers: [
          useFactory(A, [B], (b) => ({ b })),
          useFactory(B, [A], (a) => ({ a })),
        ],
      })
      class AppModule {}

      await expect(Container.create(AppModule)).rejects.toThrow(CircularDependencyError);
    });
  });

  describe("singleton behaviour", () => {
    it("class token always returns the same instance", async () => {
      @Injectable()
      class MyService {}

      @Module({ providers: [MyService] })
      class AppModule {}

      const container = await Container.create(AppModule);
      expect(container.get(MyService)).toBe(container.get(MyService));
    });

    it("InjectionToken always returns the same instance", async () => {
      const TOKEN = injection<object[]>("LIST");

      @Module({ providers: [useFactory(TOKEN, [], () => [])] })
      class AppModule {}

      const container = await Container.create(AppModule);
      expect(container.get(TOKEN)).toBe(container.get(TOKEN));
    });

    it("factory is called exactly once", async () => {
      const TOKEN = injection<number>("N");
      let calls = 0;

      @Module({ providers: [useFactory(TOKEN, [], () => ++calls)] })
      class AppModule {}

      const container = await Container.create(AppModule);
      container.get(TOKEN);
      container.get(TOKEN);
      expect(calls).toBe(1);
    });
  });

  describe("optional dependencies", () => {
    const TOKEN = injection<string>("TOKEN");

    it("injects undefined when optional dep is not registered", async () => {
      @Injectable(optional(TOKEN))
      class MyService {
        constructor(readonly value?: string) {}
      }

      @Module({ providers: [MyService] })
      class AppModule {}

      const container = await Container.create(AppModule);
      expect(container.get(MyService).value).toBeUndefined();
    });

    it("injects the value when optional dep is registered", async () => {
      @Injectable(optional(TOKEN))
      class MyService {
        constructor(readonly value?: string) {}
      }

      @Module({ providers: [useValue(TOKEN, "hello"), MyService] })
      class AppModule {}

      const container = await Container.create(AppModule);
      expect(container.get(MyService).value).toBe("hello");
    });

    it("optional dep works with class token", async () => {
      @Injectable()
      class Logger {}

      @Injectable(optional(Logger))
      class MyService {
        constructor(readonly logger?: Logger) {}
      }

      @Module({ providers: [MyService] })
      class AppModule {}

      const container = await Container.create(AppModule);
      expect(container.get(MyService).logger).toBeUndefined();
    });

    it("optional dep works in useFactory inject array", async () => {
      const RESULT = injection<string>("RESULT");

      @Module({
        providers: [
          useFactory(RESULT, [optional(TOKEN)], (val?: string) => val ?? "default"),
        ],
      })
      class AppModule {}

      const container = await Container.create(AppModule);
      expect(container.get(RESULT)).toBe("default");
    });

    it("pre-wrapped optional token reuses the same wrapped token", async () => {
      const OPTIONAL_TOKEN = optional(TOKEN);

      @Injectable(OPTIONAL_TOKEN)
      class MyService {
        constructor(readonly value?: string) {}
      }

      @Module({ providers: [MyService] })
      class AppModule {}

      const container = await Container.create(AppModule);
      expect(container.get(MyService).value).toBeUndefined();
    });
  });
});
