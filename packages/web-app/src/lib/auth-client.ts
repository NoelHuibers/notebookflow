/**
 * BetterAuth browser client. Safe to import from client components (no server
 * deps, no secrets). Talks to /api/auth/* on the same origin.
 *
 * The `jwtClient` plugin lets the app fetch a short-lived JWT (via
 * authClient.token()) to present to the engine as a bearer token.
 */

import { jwtClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [jwtClient()],
});

export const { signIn, signOut, useSession } = authClient;
