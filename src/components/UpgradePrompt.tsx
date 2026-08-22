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

export default function UpgradePrompt({ open, onOpenChange }: UpgradePromptProps) {
  const { t } = useTranslation();
  const usage = useUsage();
  const active = usage?.entitlement?.active === true;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">
            {active
              ? t("desktop.subscriptionPrompt.limitTitle")
              : t("desktop.subscriptionPrompt.title")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {active
              ? t("desktop.subscriptionPrompt.limitDescription")
              : t("desktop.subscriptionPrompt.description")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => void usage?.refetch()}
            disabled={usage?.isLoading || usage?.checkoutLoading}
          >
            {usage?.isLoading || usage?.checkoutLoading
              ? t("desktop.wallet.refreshing")
              : t("desktop.wallet.refresh")}
          </Button>
          <Button
            className="flex-1"
            onClick={() => void usage?.openBillingPortal()}
            disabled={!usage?.billingAvailable || usage?.checkoutLoading}
          >
            {active ? t("desktop.wallet.manage") : t("desktop.wallet.choosePlan")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
