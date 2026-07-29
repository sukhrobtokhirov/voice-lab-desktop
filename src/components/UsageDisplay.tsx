import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";
import { useUsage } from "../hooks/useUsage";
import { useTranslation } from "react-i18next";

function formatCredits(value: string) {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(number)
    : value;
}

function formatUpdatedAt(value: string | null, language: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(language, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function UsageDisplay({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const usage = useUsage();
  if (!usage) return null;
  const updatedAt = formatUpdatedAt(usage.updatedAt, i18n.language);

  if (!usage.hasLoaded || usage.isLoading) {
    return (
      <div
        className={
          compact
            ? "rounded-xl border border-[#e6ddd1] bg-white/55 p-3 dark:border-white/10 dark:bg-white/4"
            : "rounded-xl border border-border bg-card p-4"
        }
        aria-label={t("common.loading", { defaultValue: "Loading wallet" })}
      >
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-12 rounded-full" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-10 rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        compact
          ? "space-y-3 rounded-xl border border-[#e6ddd1] bg-white/55 p-3 dark:border-white/10 dark:bg-white/4"
          : "space-y-4 rounded-xl border border-border bg-card p-4"
      }
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">
            {t("desktop.wallet.title", { defaultValue: "AI Credit wallet" })}
          </p>
          {!compact && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("desktop.wallet.shared", {
                defaultValue: "One balance across VoiceLab products",
              })}
            </p>
          )}
        </div>
        <Badge variant="outline" className="capitalize">
          {usage.plan}
        </Badge>
      </div>

      {usage.error ? (
        <div className="space-y-2">
          <p className="text-sm text-destructive">
            {t("desktop.wallet.unavailable", {
              defaultValue: "Wallet is temporarily unavailable.",
            })}
          </p>
          <Button size="sm" variant="outline" onClick={() => void usage.refetch()}>
            {t("common.tryAgain", { defaultValue: "Try again" })}
          </Button>
        </div>
      ) : (
        <div className={compact ? "grid grid-cols-2 gap-2" : "grid grid-cols-3 gap-3"}>
          {!compact && (
            <CreditValue
              label={t("desktop.wallet.balance", { defaultValue: "Balance" })}
              value={usage.balanceCredits}
            />
          )}
          <CreditValue
            label={t("desktop.wallet.available", { defaultValue: "Available" })}
            value={usage.availableCredits}
          />
          <CreditValue
            label={t("desktop.wallet.reserved", { defaultValue: "Reserved" })}
            value={usage.reservedCredits}
          />
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {updatedAt
            ? t("desktop.wallet.updated", {
                defaultValue: "Updated {{time}}",
                time: updatedAt,
              })
            : t("desktop.wallet.live", { defaultValue: "Live balance" })}
        </p>
        <Button
          size="sm"
          variant={compact ? "ghost" : "default"}
          className={compact ? "h-7 px-2 text-xs text-[#d64d42] hover:text-[#b83e35]" : ""}
          onClick={() => void usage.openBillingPortal()}
        >
          {t("desktop.wallet.manage", { defaultValue: "Manage billing" })}
        </Button>
      </div>
    </div>
  );
}

function CreditValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-semibold tabular-nums">{formatCredits(value)}</p>
    </div>
  );
}
