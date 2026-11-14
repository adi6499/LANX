// Test harness: lets Node load src/lib/games.ts with a fake api and silent sounds.
import { registerHooks } from "node:module";
const here = new URL(".", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL ?? "";
    if (parent.includes("/src/lib/games.ts")) {
      const q = new URL(parent).search;
      if (specifier === "./api") return { url: new URL("mock-api.mjs" + q, here).href, shortCircuit: true };
      if (specifier === "./gameSounds") return { url: new URL("mock-sfx.mjs", here).href, shortCircuit: true };
      if (specifier === "./gameRules") return { url: new URL("gameRules.ts", parent.split("?")[0]).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
