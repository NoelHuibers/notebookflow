/**
 * Signed-out access policy for the engine surface.
 *
 * The hosted engine serves the node palette, port autocomplete, and the
 * bring-your-own-key AI features to signed-out visitors, but keeps pipeline
 * execution behind sign-in: running a pipeline is exec() on a shared box and
 * the session JWT is the only RCE barrier. These helpers keep that policy
 * pure and testable, away from App's render body.
 */

import { EngineRequestError } from "@/lib/EngineClient";

/**
 * Whether the Run action should be available.
 *
 * - Signed in: the session JWT authorizes hosted execution.
 * - Engine URL override: the user connected their own engine (BYO engine) —
 *   its auth posture is theirs, so Run stays available while signed out.
 * - Static engine token: a self-host deploy configured with
 *   `VITE_NOTEBOOKFLOW_ENGINE_TOKEN` authenticates every request without a
 *   session, so signed-out Run keeps working there too.
 */
export function canRunPipeline(
  signedIn: boolean,
  hasEngineOverride: boolean,
  hasStaticEngineToken = false,
): boolean {
  return signedIn || hasEngineOverride || hasStaticEngineToken;
}

/**
 * True when the engine rejected a request for missing credentials (HTTP 401).
 * For the LLM endpoints this means: signed out with no API key in Settings —
 * the caller should show the "add a key or sign in" hint instead of raw copy.
 */
export function isEngineCredentialsError(err: unknown): boolean {
  return err instanceof EngineRequestError && err.status === 401;
}
