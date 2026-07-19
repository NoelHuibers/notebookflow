import { AlertTriangle, Download, Trash2 } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { isAccountDeleteConfirmed } from "@/lib/accountDataApi";
import { formatError } from "@/lib/errors";
import { useI18n } from "@/lib/i18n";

interface AccountDataControlsProps {
  email: string;
  onExportData: () => Promise<void>;
  onDeleteAccount: () => Promise<void>;
}

export function AccountDataControls({
  email,
  onExportData,
  onDeleteAccount,
}: AccountDataControlsProps): ReactElement {
  const { t } = useI18n();
  const [accountAction, setAccountAction] = useState<"idle" | "exporting" | "deleting">("idle");
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState("");
  const [accountError, setAccountError] = useState<string | null>(null);

  const handleExportData = async (): Promise<void> => {
    setAccountAction("exporting");
    setAccountError(null);
    try {
      await onExportData();
    } catch (err: unknown) {
      setAccountError(formatError(t, err, "settings.dataExportFailedGeneric"));
    } finally {
      setAccountAction("idle");
    }
  };

  const handleDeleteAccount = async (): Promise<void> => {
    if (!isAccountDeleteConfirmed(confirmationEmail, email)) return;
    setAccountAction("deleting");
    setAccountError(null);
    try {
      await onDeleteAccount();
    } catch (err: unknown) {
      setAccountError(formatError(t, err, "settings.accountDeletionFailedGeneric"));
      setAccountAction("idle");
    }
  };

  return (
    <div className="mt-1 border-t pt-3">
      <span className="font-semibold tracking-tight">{t("settings.dataRightsSection")}</span>
      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
        {t("settings.dataRightsHelp")}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          disabled={accountAction !== "idle"}
          onClick={() => {
            void handleExportData();
          }}
        >
          <Download className="size-3.5" />
          {accountAction === "exporting" ? t("settings.exportingData") : t("settings.exportData")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={accountAction !== "idle"}
          onClick={() => {
            setShowDeleteConfirmation(true);
            setAccountError(null);
          }}
        >
          <Trash2 className="size-3.5" />
          {t("settings.deleteAccount")}
        </Button>
      </div>

      {showDeleteConfirmation && (
        <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-destructive">
                {t("settings.deleteAccountConfirmTitle")}
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                {t("settings.deleteAccountConfirmBody")}
              </p>
              <label className="mt-2 flex flex-col gap-1">
                <span className="text-[10px] text-muted-foreground">
                  {t("settings.deleteAccountConfirmLabel", { email })}
                </span>
                <input
                  type="email"
                  value={confirmationEmail}
                  autoComplete="off"
                  onChange={(event) => {
                    setConfirmationEmail(event.target.value);
                  }}
                  className="rounded-md border border-destructive/40 bg-background px-2 py-1 font-mono text-[11px] outline-none focus:ring-1 focus:ring-destructive"
                />
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7"
                  disabled={
                    accountAction === "deleting" ||
                    !isAccountDeleteConfirmed(confirmationEmail, email)
                  }
                  onClick={() => {
                    void handleDeleteAccount();
                  }}
                >
                  {accountAction === "deleting"
                    ? t("settings.deletingAccount")
                    : t("settings.deleteAccountPermanently")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7"
                  disabled={accountAction === "deleting"}
                  onClick={() => {
                    setShowDeleteConfirmation(false);
                    setConfirmationEmail("");
                    setAccountError(null);
                  }}
                >
                  {t("settings.cancelAccountDeletion")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {accountError !== null && (
        <p role="alert" className="mt-2 text-[10px] text-destructive">
          {accountError}
        </p>
      )}
    </div>
  );
}
