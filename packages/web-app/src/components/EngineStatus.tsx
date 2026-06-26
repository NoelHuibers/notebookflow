/**
 * EngineStatus — minimal top-bar engine health indicator.
 *
 * Pings `/health` on mount and on demand. Shows a colored dot + the last
 * probe's latency; the full engine URL lives in the hover title rather than
 * cluttering the bar.
 */

import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";
import type { EngineClient } from "../lib/EngineClient";
import { useI18n } from "../lib/i18n";
import { cn } from "../lib/utils";

export type EngineState = "checking" | "ready" | "down";

export interface EngineStatusProps {
  client: EngineClient;
}

const DOT_COLOR: Record<EngineState, string> = {
  ready: "bg-emerald-500",
  down: "bg-destructive",
  checking: "bg-muted-foreground animate-pulse",
};

export function EngineStatus({ client }: EngineStatusProps): ReactElement {
  const { t } = useI18n();
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

  const trailing =
    state === "ready" && latencyMs !== null
      ? `${String(latencyMs)}ms`
      : state === "down"
        ? t("app.engine.unreachable")
        : t("app.engine.pending");

  return (
    <button
      type="button"
      onClick={() => {
        void probe();
      }}
      title={t("app.engine.title", { url: client.baseUrl })}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/60"
    >
      <span className={cn("inline-block size-1.5 rounded-full", DOT_COLOR[state])} />
      {t("app.engine.label")}
      <span className="font-mono">{trailing}</span>
    </button>
  );
}
