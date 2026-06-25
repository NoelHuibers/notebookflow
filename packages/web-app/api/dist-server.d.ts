// Ambient type for the SSR server bundle, which `vite build` emits and the
// Vercel function dynamically imports. It's a build artifact (no types, absent
// at typecheck time), so declaring its shape lets the import resolve cleanly in
// every compiler — no `@ts-expect-error`/`@ts-ignore` that would flip between
// "needed" and "unused" depending on whether the bundle is present.
declare module "*/dist/server/server.js" {
  const handler: { fetch: (request: Request) => Promise<Response> };
  export default handler;
}
