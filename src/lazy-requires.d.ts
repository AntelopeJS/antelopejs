export {};

declare global {
  namespace NodeJS {
    interface Require {
      /**
       * Loads interface-core's logging entry on first use. The id names the
       * same package entry a static import of it resolves to, so `require`
       * returns the module that import would type.
       */
      (
        id: "@antelopejs/interface-core/logging",
      ): typeof import("@antelopejs/interface-core/logging");
    }
  }
}
