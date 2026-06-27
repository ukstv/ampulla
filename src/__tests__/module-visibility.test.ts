import { describe, it, expect } from "vitest";
import {
  Container,
  Module,
  Injectable,
  injection,
  useValue,
  useFactory,
  ProviderNotFoundError,
} from "../index.js";

describe("module visibility", () => {
  describe("root module", () => {
    it("class provider in root module is accessible", async () => {
      @Injectable()
      class Service {}

      @Module({ providers: [Service] })
      class AppModule {}

      const container = await Container.create(AppModule);
      expect(container.get(Service)).toBeInstanceOf(Service);
    });

    it("value provider in root module is accessible", async () => {
      const TOKEN = injection<string>("TOKEN");

      @Module({ providers: [useValue(TOKEN, "hello")] })
      class AppModule {}

      const container = await Container.create(AppModule);
      expect(container.get(TOKEN)).toBe("hello");
    });
  });

  describe("cross-module visibility", () => {
    it("exported provider from imported module is accessible from root", async () => {
      @Injectable()
      class Service {}

      @Module({ providers: [Service], exports: [Service] })
      class ServiceModule {}

      @Module({ imports: [ServiceModule] })
      class AppModule {}

      const container = await Container.create(AppModule);
      expect(container.get(Service)).toBeInstanceOf(Service);
    });

    it("non-exported provider is not accessible from root", async () => {
      @Injectable()
      class Service {}

      @Module({ providers: [Service] }) // no exports
      class ServiceModule {}

      @Module({ imports: [ServiceModule] })
      class AppModule {}

      const container = await Container.create(AppModule);
      expect(() => container.get(Service)).toThrow(ProviderNotFoundError);
    });

    it("non-exported provider is not accessible even if its module is imported", async () => {
      const INTERNAL = injection<string>("INTERNAL");
      const PUBLIC = injection<string>("PUBLIC");

      @Module({
        providers: [useValue(INTERNAL, "secret"), useValue(PUBLIC, "visible")],
        exports: [PUBLIC], // INTERNAL is intentionally not exported
      })
      class ServiceModule {}

      @Module({ imports: [ServiceModule] })
      class AppModule {}

      const container = await Container.create(AppModule);
      expect(container.get(PUBLIC)).toBe("visible");
      expect(() => container.get(INTERNAL)).toThrow(ProviderNotFoundError);
    });

    it("module re-export: root imports A which re-exports B", async () => {
      @Injectable()
      class Service {}

      @Module({ providers: [Service], exports: [Service] })
      class B {}

      @Module({ imports: [B], exports: [B] })
      class A {}

      @Module({ imports: [A] })
      class AppModule {}

      const container = await Container.create(AppModule);
      expect(container.get(Service)).toBeInstanceOf(Service);
    });

    it("deep re-export chain A→B→C is fully resolved", async () => {
      @Injectable()
      class Service {}

      @Module({ providers: [Service], exports: [Service] })
      class C {}

      @Module({ imports: [C], exports: [C] })
      class B {}

      @Module({ imports: [B], exports: [B] })
      class A {}

      @Module({ imports: [A] })
      class AppModule {}

      const container = await Container.create(AppModule);
      expect(container.get(Service)).toBeInstanceOf(Service);
    });
  });

  describe("re-export scoping", () => {
    it("module re-exports two modules; token only in the second is still resolved", async () => {
      @Injectable()
      class ServiceA {}

      @Injectable()
      class ServiceB {}

      @Module({ providers: [ServiceA], exports: [ServiceA] })
      class ModuleA {}

      @Module({ providers: [ServiceB], exports: [ServiceB] })
      class ModuleB {}

      // Mid re-exports both; token lives only in ModuleB
      @Module({ imports: [ModuleA, ModuleB], exports: [ModuleA, ModuleB] })
      class Mid {}

      @Module({ imports: [Mid] })
      class AppModule {}

      const container = await Container.create(AppModule);
      expect(container.get(ServiceB)).toBeInstanceOf(ServiceB);
    });
  });

  describe("provider dep scoping", () => {
    it("exported provider's deps are resolved from its own module, not the importer's", async () => {
      // InternalDep is NOT exported — it should never be visible to AppModule.
      // But Service (which depends on it) is exported and must still work.
      const INTERNAL = injection<string>("INTERNAL");

      @Injectable(INTERNAL)
      class Service {
        constructor(public readonly value: string) {}
      }

      @Module({
        providers: [useValue(INTERNAL, "from-service-module"), Service],
        exports: [Service],
      })
      class ServiceModule {}

      @Module({ imports: [ServiceModule] })
      class AppModule {}

      const container = await Container.create(AppModule);
      // Service resolved from ServiceModule using its own INTERNAL provider
      expect(container.get(Service).value).toBe("from-service-module");
      // INTERNAL itself is not visible from the root
      expect(() => container.get(INTERNAL)).toThrow(ProviderNotFoundError);
    });
  });

  describe("diamond imports", () => {
    it("module imported via two paths is compiled once", async () => {
      let instances = 0;

      @Injectable()
      class SharedService {
        readonly id: number;
        constructor() {
          this.id = ++instances;
        }
      }

      @Module({ providers: [SharedService], exports: [SharedService] })
      class SharedModule {}

      @Module({ imports: [SharedModule], exports: [SharedModule] })
      class ModuleA {}

      @Module({ imports: [SharedModule], exports: [SharedModule] })
      class ModuleB {}

      @Module({ imports: [ModuleA, ModuleB] })
      class AppModule {}

      const container = await Container.create(AppModule);

      expect(instances).toBe(1);
      expect(container.get(SharedService).id).toBe(1);
    });

    it("all consumers of a diamond-imported module share the same instance", async () => {
      @Injectable()
      class SharedService {}

      @Module({ providers: [SharedService], exports: [SharedService] })
      class SharedModule {}

      @Module({ imports: [SharedModule], exports: [SharedModule] })
      class ModuleA {}

      @Module({ imports: [SharedModule], exports: [SharedModule] })
      class ModuleB {}

      @Module({ imports: [ModuleA, ModuleB] })
      class AppModule {}

      const container = await Container.create(AppModule);

      // same reference regardless of which import path resolved it
      const instance = container.get(SharedService);
      expect(instance).toBe(container.get(SharedService));
    });
  });
});
