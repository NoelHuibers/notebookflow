// Shim around better-auth's Drizzle adapter.
//
// `better-auth/adapters/drizzle` points its ESM `types` at an `index.d.mts`
// that omits the `drizzleAdapter` export (a packaging bug), so a direct import
// fails under the function's NodeNext resolution even though the runtime `.mjs`
// exports it (and `bundler` resolution finds it fine). Re-export through here so
// the one suppression lives in a single line.
//
// It must be @ts-ignore (not @ts-expect-error): under `bundler` the import
// resolves, so @ts-expect-error would flip to an "unused directive" error.
// noTsIgnore is disabled for this file in biome.json for the same reason.

// @ts-ignore better-auth's .d.mts is missing this export; the value exists at runtime.
export { drizzleAdapter } from "better-auth/adapters/drizzle";
