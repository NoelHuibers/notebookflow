/**
 * EngineStatus — small badge showing whether the engine is reachable.
 *
 * Pings `/health` on mount and on demand; surfaces the configured URL
 * so users can sanity-check what they're hitting.
 */

import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";
import type { EngineClient } from "../lib/EngineClient";
import { Badge } from "./ui/badge";

export type EngineState = "checking" | "ready" | "down";

export interface EngineStatusProps {
  client: EngineClient;
}

export function EngineStatus({ client }: EngineStatusProps): ReactElement {
  const [state, setState] = useState<EngineState>("checking");

  const probe = useCallback(async (): Promise<void> => {
    setState("checking");
    const ok = await client.ping();
    setState(ok ? "ready" : "down");
  }, [client]);

  useEffect(() => {
    void probe();
  }, [probe]);

  const variant = state === "ready" ? "default" : state === "down" ? "destructive" : "secondary";
  const label =
    state === "ready" ? "engine: ready" : state === "down" ? "engine: down" : "engine: …";

  return (
    <button
      type="button"
      onClick={() => {
        void probe();
      }}
      title={`Engine URL: ${client.baseUrl}\nClick to re-check`}
      className="cursor-pointer"
    >
      <Badge variant={variant} className="font-mono">
        {label}
      </Badge>
    </button>
  );
}
