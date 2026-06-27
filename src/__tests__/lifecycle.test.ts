import { describe, it, expect } from "vitest";
import {
  Container,
  Module,
  Injectable,
  OnModuleInit,
  injection,
  useFactory,
} from "../index.js";

describe("onModuleInit", () => {
  it("hook is called after providers are initialized", async () => {
    let called = false;

    @OnModuleInit()
    @Injectable()
    class Service {
      onModuleInit() {
        called = true;
      }
    }

    @Module({ providers: [Service] })
    class AppModule {}

    await Container.create(AppModule);
    expect(called).toBe(true);
  });

  it("async hook is awaited before container resolves", async () => {
    const steps: string[] = [];

    @Injectable()
    @OnModuleInit()
    class Service {
      async onModuleInit() {
        steps.push("init:start");
        await Promise.resolve();
        steps.push("init:end");
      }
    }

    @Module({ providers: [Service] })
    class AppModule {}

    steps.push("create:start");
    await Container.create(AppModule);
    steps.push("create:end");

    expect(steps).toEqual([
      "create:start",
      "init:start",
      "init:end",
      "create:end",
    ]);
  });

  it("custom method name via @OnModuleInit('setup')", async () => {
    let called = false;

    @Injectable()
    @OnModuleInit("setup")
    class Service {
      setup() {
        called = true;
      }
    }

    @Module({ providers: [Service] })
    class AppModule {}

    await Container.create(AppModule);
    expect(called).toBe(true);
  });

  it("class without @OnModuleInit decorator is not called", async () => {
    let called = false;

    @Injectable()
    class Service {
      onModuleInit() {
        called = true;
      }
    }

    @Module({ providers: [Service] })
    class AppModule {}

    await Container.create(AppModule);
    expect(called).toBe(false);
  });

  it("full lifecycle progression across two modules with async factories", async () => {
    const steps: string[] = [];

    // --- Module B ---
    const CONFIG_B = injection<string>("CONFIG_B");

    @OnModuleInit()
    @Injectable(CONFIG_B)
    class ServiceB {
      constructor(public readonly config: string) {}

      async onModuleInit() {
        steps.push("B:init:start");
        await Promise.resolve();
        steps.push("B:init:end");
      }
    }

    @Module({
      providers: [
        useFactory(CONFIG_B, [], async () => {
          steps.push("B:factory:start");
          await Promise.resolve();
          steps.push("B:factory:end");
          return "config-b";
        }),
        ServiceB,
      ],
      exports: [ServiceB],
    })
    class ModuleB {}

    // --- Module A (depends on B) ---
    const CONFIG_A = injection<string>("CONFIG_A");

    @OnModuleInit()
    @Injectable(ServiceB, CONFIG_A)
    class ServiceA {
      constructor(
        public readonly b: ServiceB,
        public readonly config: string,
      ) {}

      async onModuleInit() {
        steps.push("A:init:start");
        await Promise.resolve();
        steps.push("A:init:end");
      }
    }

    @Module({
      imports: [ModuleB],
      providers: [
        useFactory(CONFIG_A, [], async () => {
          steps.push("A:factory:start");
          await Promise.resolve();
          steps.push("A:factory:end");
          return "config-a";
        }),
        ServiceA,
      ],
      exports: [ServiceA],
    })
    class ModuleA {}

    @Module({ imports: [ModuleA] })
    class AppModule {}

    await Container.create(AppModule);

    // CONFIG_A is in ModuleA's records — processed before ModuleB's records.
    // ServiceA's dep chain synchronously triggers ServiceB → CONFIG_B before any
    // microtask fires, so both factories start in the same tick.
    // CONFIG_A's microtask was queued first, so it finishes first.
    // Once both configs resolve, ServiceB is constructed, then ServiceA.
    // Hooks fire in resolution/insertion order: B before A.
    expect(steps).toEqual([
      "A:factory:start",
      "B:factory:start",
      "A:factory:end",
      "B:factory:end",
      "B:init:start",
      "B:init:end",
      "A:init:start",
      "A:init:end",
    ]);

    // ServiceA received the real ServiceB instance
    const container = await Container.create(AppModule);
    expect(container.get(ServiceA).b).toBeInstanceOf(ServiceB);
    expect(container.get(ServiceA).config).toBe("config-a");
  });
});
