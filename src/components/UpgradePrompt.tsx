import { Dialog, DialogContent } from "./ui/dialog";
import { Button } from "./ui/button";
import { useUsage } from "../hooks/useUsage";
import { useTranslation } from "react-i18next";

export interface CreditShortage {
  availableCredits?: string | number | null;
  requiredCredits?: string | number | null;
}

interface UpgradePromptProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shortage?: CreditShortage | null;
}

export default function UpgradePrompt({ open, onOpenChange, shortage }: UpgradePromptProps) {
  const { t } = useTranslation();
  const usage = useUsage();
  const available = shortage?.availableCredits ?? usage?.availableCredits ?? "0";
  const required = shortage?.requiredCredits;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">
            {t("desktop.creditShortage.title", { defaultValue: "More AI Credits needed" })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("desktop.creditShortage.description", {
              defaultValue:
                "There are not enough available credits for this recording. Add credits or choose a plan.",
            })}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/50 p-3 text-sm">
          <div>
            <span className="block text-xs text-muted-foreground">
              {t("desktop.wallet.available", { defaultValue: "Available" })}
            </span>
            <strong>{available} credits</strong>
          </div>
          {required != null && (
            <div>
              <span className="block text-xs text-muted-foreground">
                {t("desktop.creditShortage.required", { defaultValue: "Needed" })}
              </span>
              <strong>{required} credits</strong>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Button onClick={() => void usage?.openBillingPortal()}>
            {t("desktop.wallet.manage", { defaultValue: "Manage billing" })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
