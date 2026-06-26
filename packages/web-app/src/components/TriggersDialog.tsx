import { ChevronDown, ChevronRight, Copy, Play, Plus, Trash2, X, Zap } from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { EngineClient, TriggerFiring, TriggerKind, TriggerSpec } from "@/lib/EngineClient";
import { useI18n } from "@/lib/i18n";
import { truncate } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Triggers (#20). Backed by the /triggers REST surface that shipped with #8.
// The default on_fire callback on the engine just logs -- "this trigger
// fired" is the signal, "the pipeline auto-ran" is future work. We hide
// pipelineId from the form to avoid implying otherwise.
// ---------------------------------------------------------------------------

// kind → translation key (the label copy itself lives in the `triggers` catalog).
const TRIGGER_KIND_LABEL_KEY: Record<TriggerKind, string> = {
  manual: "triggers.kindManual",
  cron: "triggers.kindCron",
  file_watch: "triggers.kindFileWatch",
  webhook: "triggers.kindWebhook",
};

const TRIGGER_KINDS: TriggerKind[] = ["manual", "cron", "file_watch", "webhook"];

// Cron expressions are data, not copy, so they stay literal; only the preset label
// is translated via `labelKey`.
const CRON_PRESETS: { labelKey: string; expression: string }[] = [
  { labelKey: "triggers.presetEvery5Min", expression: "*/5 * * * *" },
  { labelKey: "triggers.presetHourly", expression: "0 * * * *" },
  { labelKey: "triggers.presetDaily9am", expression: "0 9 * * *" },
];

const CRON_REGEX = /^(\S+\s+){4}\S+$/;

interface TriggersDialogProps {
  client: EngineClient;
  triggers: TriggerSpec[];
  errorMessage: string | null;
  isLoading: boolean;
  onRefresh: () => void;
  onClose: () => void;
}

export function TriggersDialog({
  client,
  triggers,
  errorMessage,
  isLoading,
  onRefresh,
  onClose,
}: TriggersDialogProps): ReactElement {
  const { t } = useI18n();
  const [isCreating, setIsCreating] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 p-6 pt-[10vh] backdrop-blur">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col gap-3 overflow-hidden rounded-md border bg-card p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Zap className="size-4 text-primary" />
            {t("triggers.title")}
            <Badge variant="outline" className="font-mono text-[10px]">
              {triggers.length}
            </Badge>
          </span>
          <div className="flex items-center gap-1">
            {!isCreating && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsCreating(true);
                }}
              >
                <Plus className="mr-1.5 size-3.5" />
                {t("triggers.newTrigger")}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-1.5"
              onClick={onClose}
              aria-label={t("triggers.dismiss")}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
        {errorMessage !== null && (
          <p className="rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
            {errorMessage}
          </p>
        )}
        {isCreating ? (
          <TriggerCreateForm
            client={client}
            onCancel={() => {
              setIsCreating(false);
            }}
            onCreated={() => {
              setIsCreating(false);
              onRefresh();
            }}
          />
        ) : (
          <ScrollArea className="min-h-[200px] flex-1 rounded border bg-muted/30 p-2">
            {triggers.length === 0 ? (
              <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">
                {isLoading ? t("triggers.loading") : t("triggers.empty")}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {triggers.map((trigger) => (
                  <TriggerListItem
                    key={trigger.id}
                    client={client}
                    trigger={trigger}
                    onChanged={onRefresh}
                  />
                ))}
              </ul>
            )}
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

interface TriggerCreateFormProps {
  client: EngineClient;
  onCancel: () => void;
  onCreated: () => void;
}

function TriggerCreateForm({ client, onCancel, onCreated }: TriggerCreateFormProps): ReactElement {
  const { t } = useI18n();
  const [kind, setKind] = useState<TriggerKind>("manual");
  const [id, setId] = useState(() => `trigger-${Date.now().toString(36)}`);
  const [expression, setExpression] = useState("");
  const [pathsText, setPathsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const cronShapeOk = expression.trim() === "" || CRON_REGEX.test(expression.trim());

  async function handleSubmit(): Promise<void> {
    if (id.trim() === "") {
      setError(t("triggers.errorIdEmpty"));
      return;
    }
    let config: Record<string, unknown> = {};
    if (kind === "cron") {
      if (expression.trim() === "") {
        setError(t("triggers.errorCronRequired"));
        return;
      }
      config = { expression: expression.trim() };
    } else if (kind === "file_watch") {
      const paths = pathsText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "");
      if (paths.length === 0) {
        setError(t("triggers.errorPathRequired"));
        return;
      }
      config = { paths };
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await client.registerTrigger({
        id: id.trim(),
        kind,
        pipelineId: "default",
        config,
      });
      onCreated();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t("triggers.errorUnknown");
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-1">
        {TRIGGER_KINDS.map((k) => (
          <Button
            key={k}
            variant={kind === k ? "default" : "outline"}
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => {
              setKind(k);
              setError(null);
            }}
          >
            {t(TRIGGER_KIND_LABEL_KEY[k])}
          </Button>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-[11px]">
        <span className="text-muted-foreground">{t("triggers.triggerId")}</span>
        <input
          value={id}
          onChange={(event) => {
            setId(event.target.value);
          }}
          className="rounded border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
          aria-label={t("triggers.triggerId")}
        />
      </label>
      {kind === "cron" && (
        <div className="flex flex-col gap-1.5 text-[11px]">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">{t("triggers.cronExpressionLabel")}</span>
            <input
              value={expression}
              onChange={(event) => {
                setExpression(event.target.value);
              }}
              placeholder="*/5 * * * *"
              className="rounded border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
              aria-label={t("triggers.cronExpressionAria")}
            />
          </label>
          {!cronShapeOk && (
            <span className="text-[10px] text-amber-600">{t("triggers.cronShapeWarning")}</span>
          )}
          <div className="flex flex-wrap gap-1">
            {CRON_PRESETS.map((preset) => (
              <Button
                key={preset.expression}
                variant="outline"
                size="sm"
                className="h-6 px-2 font-mono text-[10px]"
                onClick={() => {
                  setExpression(preset.expression);
                }}
              >
                {t(preset.labelKey)}
              </Button>
            ))}
          </div>
        </div>
      )}
      {kind === "file_watch" && (
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="text-muted-foreground">{t("triggers.pathsLabel")}</span>
          <textarea
            value={pathsText}
            onChange={(event) => {
              setPathsText(event.target.value);
            }}
            rows={3}
            placeholder="./data&#10;./inputs"
            className="resize-none rounded border bg-background px-2 py-1 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
            aria-label={t("triggers.pathsAria")}
          />
          <span className="text-[10px] text-muted-foreground">{t("triggers.pathsHint")}</span>
        </label>
      )}
      {kind === "webhook" && (
        <p className="text-[11px] text-muted-foreground">{t("triggers.webhookDescription")}</p>
      )}
      {kind === "manual" && (
        <p className="text-[11px] text-muted-foreground">
          {t("triggers.manualDescriptionPrefix")}
          <strong>{t("triggers.manualDescriptionFireNow")}</strong>
          {t("triggers.manualDescriptionSuffix")}
        </p>
      )}
      {error !== null && (
        <p className="rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button
          variant="default"
          size="sm"
          onClick={() => {
            void handleSubmit();
          }}
          disabled={isSubmitting}
        >
          {isSubmitting ? t("triggers.saving") : t("triggers.saveTrigger")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isSubmitting}>
          {t("triggers.cancel")}
        </Button>
      </div>
    </div>
  );
}

interface TriggerListItemProps {
  client: EngineClient;
  trigger: TriggerSpec;
  onChanged: () => void;
}

function TriggerListItem({ client, trigger, onChanged }: TriggerListItemProps): ReactElement {
  const { t } = useI18n();
  const [isExpanded, setIsExpanded] = useState(false);
  const [firings, setFirings] = useState<TriggerFiring[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isFiring, setIsFiring] = useState(false);
  const [copied, setCopied] = useState(false);

  // Manual triggers only fire from this UI -- no point polling them.
  const shouldPoll = isExpanded && trigger.kind !== "manual";

  useEffect(() => {
    if (!isExpanded) {
      return;
    }
    let cancelled = false;
    async function refresh(): Promise<void> {
      try {
        const list = await client.listFirings(trigger.id);
        if (!cancelled) {
          setFirings(list);
        }
      } catch {
        // Quietly drop; the firings count badge stays at its prior value.
      }
    }
    void refresh();
    if (!shouldPoll) {
      return () => {
        cancelled = true;
      };
    }
    const interval = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [client, trigger.id, isExpanded, shouldPoll]);

  async function handleFire(): Promise<void> {
    setIsFiring(true);
    setActionError(null);
    try {
      const firing = await client.fireTrigger(trigger.id);
      setFirings((prev) => [...prev, firing]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t("triggers.errorUnknown");
      setActionError(t("triggers.fireFailed", { message }));
    } finally {
      setIsFiring(false);
    }
  }

  async function handleDelete(): Promise<void> {
    setActionError(null);
    try {
      await client.unregisterTrigger(trigger.id);
      onChanged();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t("triggers.errorUnknown");
      setActionError(t("triggers.deleteFailed", { message }));
    }
  }

  const webhookUrl = trigger.kind === "webhook" ? client.webhookUrl(trigger.id) : "";

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      setActionError(t("triggers.copyFailed"));
    }
  }

  return (
    <li className="rounded border bg-background p-2 text-[12px]">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setIsExpanded((prev) => !prev);
          }}
          className="flex flex-1 items-center gap-2 text-left"
          aria-label={isExpanded ? t("triggers.collapseTrigger") : t("triggers.expandTrigger")}
        >
          {isExpanded ? (
            <ChevronDown className="size-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3 text-muted-foreground" />
          )}
          <Badge variant="outline" className="font-mono text-[10px]">
            {t(TRIGGER_KIND_LABEL_KEY[trigger.kind])}
          </Badge>
          <span className="truncate font-mono text-[11px]">{trigger.id}</span>
          <span className="text-[10px] text-muted-foreground">
            {firings.length > 0 && t("triggers.firingsCount", { count: firings.length })}
          </span>
        </button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px]"
          onClick={() => {
            void handleFire();
          }}
          disabled={isFiring}
        >
          <Play className="mr-1 size-3" />
          {t("triggers.fireNow")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-destructive"
          onClick={() => {
            void handleDelete();
          }}
          aria-label={t("triggers.deleteTrigger")}
        >
          <Trash2 className="size-3" />
        </Button>
      </div>
      {actionError !== null && (
        <p className="mt-1.5 rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-[10px] text-destructive">
          {actionError}
        </p>
      )}
      {isExpanded && trigger.kind === "webhook" && (
        <div className="mt-2 flex flex-col gap-1 rounded border bg-muted/50 p-2 font-mono text-[10px]">
          <div className="flex items-center justify-between gap-2">
            <code className="break-all">POST {webhookUrl}</code>
            <Button
              variant="outline"
              size="sm"
              className="h-6 shrink-0 px-2 text-[10px]"
              onClick={() => {
                void handleCopy();
              }}
            >
              <Copy className="mr-1 size-3" />
              {copied ? t("triggers.copied") : t("triggers.copyUrl")}
            </Button>
          </div>
          <span className="text-muted-foreground">{t("triggers.webhookBodyHint")}</span>
          <span className="text-muted-foreground">{t("triggers.webhookAuthHint")}</span>
        </div>
      )}
      {isExpanded && Object.keys(trigger.config).length > 0 && trigger.kind !== "webhook" && (
        <pre className="mt-2 overflow-x-auto rounded border bg-muted/50 px-2 py-1 font-mono text-[10px]">
          {JSON.stringify(trigger.config, null, 2)}
        </pre>
      )}
      {isExpanded && (
        <div className="mt-2 flex flex-col gap-1">
          <span className="text-[10px] text-muted-foreground">
            {t("triggers.firingsHeading", { count: firings.length })}
            {shouldPoll && t("triggers.firingsRefreshNote")}
          </span>
          {firings.length === 0 ? (
            <p className="rounded border bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground">
              {t("triggers.noFirings")}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5 font-mono text-[10px]">
              {firings
                .slice()
                .reverse()
                .map((firing, idx) => (
                  <li
                    key={`${String(firing.firedAt)}-${String(idx)}`}
                    className="rounded border bg-muted/30 px-2 py-1"
                  >
                    <span className="text-muted-foreground">
                      {new Date(firing.firedAt * 1000).toLocaleTimeString()}
                    </span>
                    {Object.keys(firing.payload).length > 0 && (
                      <span className="ml-2 text-foreground/70">
                        {truncate(JSON.stringify(firing.payload), 80)}
                      </span>
                    )}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
