import { describe, it, expect } from "vitest";
import {
  Container,
  Module,
  Injectable,
  injection,
  useValue,
  InvalidExportError,
} from "../index.js";

describe("export validation", () => {
  it("valid exports do not throw", async () => {
    const TOKEN = injection<string>("TOKEN");

    @Injectable()
    class Service {}

    @Module({ providers: [Service, useValue(TOKEN, "x")], exports: [Service, TOKEN] })
    class AppModule {}

    await expect(Container.create(AppModule)).resolves.toBeDefined();
  });

  it("exporting an InjectionToken not in providers throws", async () => {
    const MISSING = injection<string>("MISSING");

    @Module({ providers: [], exports: [MISSING] })
    class AppModule {}

    await expect(Container.create(AppModule)).rejects.toThrow(InvalidExportError);
    await expect(Container.create(AppModule)).rejects.toThrow(/MISSING/);
  });

  it("error names the module that made the invalid export", async () => {
    const TOKEN = injection<string>("TOKEN");

    @Module({ exports: [TOKEN] })
    class BadModule {}

    await expect(Container.create(BadModule)).rejects.toThrow(InvalidExportError);
    await expect(Container.create(BadModule)).rejects.toThrow(/BadModule/);
  });

  it("exporting a class token not in providers throws", async () => {
    @Injectable()
    class Service {}

    @Module({ providers: [], exports: [Service] })
    class AppModule {}

    await expect(Container.create(AppModule)).rejects.toThrow(InvalidExportError);
    await expect(Container.create(AppModule)).rejects.toThrow(/Service/);
  });

  it("re-exporting a module that is not imported throws", async () => {
    @Injectable()
    class Service {}

    @Module({ providers: [Service], exports: [Service] })
    class InnerModule {}

    // InnerModule is not in imports
    @Module({ exports: [InnerModule] })
    class OuterModule {}

    // importing OuterModule triggers compilation of InnerModule, making it
    // known to the container, so the "re-export without import" path fires
    @Module({ imports: [InnerModule, OuterModule] })
    class AppModule {}

    await expect(Container.create(AppModule)).rejects.toThrow(InvalidExportError);
    await expect(Container.create(AppModule)).rejects.toThrow(/OuterModule/);
  });

  it("valid module re-export does not throw", async () => {
    @Injectable()
    class Service {}

    @Module({ providers: [Service], exports: [Service] })
    class InnerModule {}

    @Module({ imports: [InnerModule], exports: [InnerModule] })
    class OuterModule {}

    @Module({ imports: [OuterModule] })
    class AppModule {}

    await expect(Container.create(AppModule)).resolves.toBeDefined();
  });
});
