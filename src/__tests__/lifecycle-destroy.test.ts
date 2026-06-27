import { describe, it, expect } from "vitest";
import {
  Container,
  Module,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  injection,
  useValue,
} from "../index.js";

describe("onModuleDestroy", () => {
  it("hook is called after dispose()", async () => {
    let called = false;

    @OnModuleDestroy()
    @Injectable()
    class Service {
      onModuleDestroy() {
        called = true;
      }
    }

    @Module({ providers: [Service] })
    class AppModule {}

    const container = await Container.create(AppModule);
    expect(called).toBe(false);
    await container.dispose();
    expect(called).toBe(true);
  });

  it("async hook is awaited before dispose() resolves", async () => {
    const steps: string[] = [];

    @OnModuleDestroy()
    @Injectable()
    class Service {
      async onModuleDestroy() {
        steps.push("destroy:start");
        await Promise.resolve();
        steps.push("destroy:end");
      }
    }

    @Module({ providers: [Service] })
    class AppModule {}

    const container = await Container.create(AppModule);
    steps.push("dispose:start");
    await container.dispose();
    steps.push("dispose:end");

    expect(steps).toEqual([
      "dispose:start",
      "destroy:start",
      "destroy:end",
      "dispose:end",
    ]);
  });

  it("custom method name via @OnModuleDestroy('teardown')", async () => {
    let called = false;

    @OnModuleDestroy("teardown")
    @Injectable()
    class Service {
      teardown() {
        called = true;
      }
    }

    @Module({ providers: [Service] })
    class AppModule {}

    const container = await Container.create(AppModule);
    await container.dispose();
    expect(called).toBe(true);
  });

  it("class without @OnModuleDestroy decorator is not called", async () => {
    let called = false;

    @Injectable()
    class Service {
      onModuleDestroy() {
        called = true;
      }
    }

    @Module({ providers: [Service] })
    class AppModule {}

    const container = await Container.create(AppModule);
    await container.dispose();
    expect(called).toBe(false);
  });

  it("hooks fire in reverse dependency order (dependents before deps)", async () => {
    const steps: string[] = [];

    @OnModuleDestroy()
    @Injectable()
    class Dep {
      onModuleDestroy() {
        steps.push("Dep:destroy");
      }
    }

    @OnModuleDestroy()
    @Injectable(Dep)
    class Consumer {
      constructor(public dep: Dep) {}
      onModuleDestroy() {
        steps.push("Consumer:destroy");
      }
    }

    @Module({ providers: [Dep, Consumer] })
    class AppModule {}

    const container = await Container.create(AppModule);
    await container.dispose();

    // Consumer was initialized after Dep, so it's destroyed first
    expect(steps).toEqual(["Consumer:destroy", "Dep:destroy"]);
  });

  it("dispose() clears internal state so get() throws afterwards", async () => {
    @Injectable()
    class Service {}

    @Module({ providers: [Service] })
    class AppModule {}

    const container = await Container.create(AppModule);
    expect(container.get(Service)).toBeInstanceOf(Service);

    await container.dispose();
    expect(() => container.get(Service)).toThrow();
  });

  it("[Symbol.asyncDispose] is equivalent to dispose()", async () => {
    let called = false;

    @OnModuleDestroy()
    @Injectable()
    class Service {
      onModuleDestroy() {
        called = true;
      }
    }

    @Module({ providers: [Service] })
    class AppModule {}

    const container = await Container.create(AppModule);
    await container[Symbol.asyncDispose]();
    expect(called).toBe(true);
  });

  it("await using triggers [Symbol.asyncDispose]", async () => {
    let called = false;

    @OnModuleDestroy()
    @Injectable()
    class Service {
      onModuleDestroy() {
        called = true;
      }
    }

    @Module({ providers: [Service] })
    class AppModule {}

    {
      await using container = await Container.create(AppModule);
      void container; // suppress unused variable warning
    }

    expect(called).toBe(true);
  });

  it("non-class providers are skipped — only class instances get onModuleDestroy called", async () => {
    let called = false;
    const TOKEN = injection<string>("TOKEN");

    @OnModuleDestroy()
    @Injectable()
    class Service {
      onModuleDestroy() {
        called = true;
      }
    }

    @Module({ providers: [useValue(TOKEN, "x"), Service] })
    class AppModule {}

    const container = await Container.create(AppModule);
    await container.dispose();
    expect(called).toBe(true);
  });

  it("dispose() called twice is a no-op on the second call", async () => {
    let calls = 0;

    @OnModuleDestroy()
    @Injectable()
    class Service {
      onModuleDestroy() {
        calls++;
      }
    }

    @Module({ providers: [Service] })
    class AppModule {}

    const container = await Container.create(AppModule);
    await container.dispose();
    await container.dispose();
    expect(calls).toBe(1);
  });

  it("full two-module lifecycle: init order then reverse destroy order", async () => {
    const steps: string[] = [];

    @OnModuleInit()
    @OnModuleDestroy()
    @Injectable()
    class ServiceB {
      onModuleInit() {
        steps.push("B:init");
      }
      onModuleDestroy() {
        steps.push("B:destroy");
      }
    }

    @Module({ providers: [ServiceB], exports: [ServiceB] })
    class ModuleB {}

    @OnModuleInit()
    @OnModuleDestroy()
    @Injectable(ServiceB)
    class ServiceA {
      constructor(public b: ServiceB) {}
      onModuleInit() {
        steps.push("A:init");
      }
      onModuleDestroy() {
        steps.push("A:destroy");
      }
    }

    @Module({ imports: [ModuleB], providers: [ServiceA], exports: [ServiceA] })
    class ModuleA {}

    @Module({ imports: [ModuleA] })
    class AppModule {}

    const container = await Container.create(AppModule);
    await container.dispose();

    expect(steps).toEqual(["B:init", "A:init", "A:destroy", "B:destroy"]);
  });
});
