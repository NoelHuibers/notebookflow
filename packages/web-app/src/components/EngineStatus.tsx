/**
 * EngineStatus — top-bar badge showing engine reachability + host + latency.
 *
 * Pings `/health` on mount and on demand. The badge surfaces the host:port
 * the client is talking to and the round-trip latency of the last probe so
 * users can sanity-check what they're hitting at a glance.
 */

import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { EngineClient } from "../lib/EngineClient";

import { Badge } from "./ui/badge";

export type EngineState = "checking" | "ready" | "down";

export interface EngineStatusProps {
  client: EngineClient;
}

export function EngineStatus({ client }: EngineStatusProps): ReactElement {
  const [state, setState] = useState<EngineState>("checking");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const probe = useCallback(async (): Promise<void> => {
    setState("checking");
    const start = performance.now();
    const ok = await client.ping();
    const elapsed = performance.now() - start;
    setLatencyMs(Math.round(elapsed));
    setState(ok ? "ready" : "down");
  }, [client]);

  useEffect(() => {
    void probe();
  }, [probe]);

  const host = useMemo(() => extractHost(client.baseUrl), [client.baseUrl]);

  const variant = state === "ready" ? "default" : state === "down" ? "destructive" : "secondary";
  const trailing =
    state === "ready" && latencyMs !== null
      ? ` · ${String(latencyMs)}ms`
      : state === "down"
        ? " · unreachable"
        : " · …";

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
        engine · {host}
        {trailing}
      </Badge>
    </button>
  );
}

function extractHost(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host === "" ? url : parsed.host;
  } catch {
    return url;
  }
}
