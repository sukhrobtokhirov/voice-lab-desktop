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

  if (compact) {
    if (!usage.hasLoaded || usage.isLoading) {
      return (
        <div
          className="flex h-10 items-center gap-2.5 rounded-lg px-2.5"
          aria-label={t("common.loading", { defaultValue: "Loading wallet" })}
        >
          <Skeleton className="h-7 w-7 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-2.5 w-28" />
          </div>
        </div>
      );
    }

    if (usage.error) {
      return (
        <button
          type="button"
          onClick={() => void usage.refetch()}
          className="flex min-h-10 w-full items-center justify-between gap-2 rounded-lg px-2.5 text-left text-[13px] text-destructive outline-none transition-colors hover:bg-destructive/5 focus-visible:ring-2 focus-visible:ring-destructive/20"
        >
          <span className="truncate">
            {t("desktop.wallet.unavailable", {
              defaultValue: "Wallet is temporarily unavailable.",
            })}
          </span>
          <span className="shrink-0 text-xs font-medium">
            {t("common.tryAgain", { defaultValue: "Try again" })}
          </span>
        </button>
      );
    }

    const balance = Number(usage.balanceCredits);
    const available = Number(usage.availableCredits);
    const percentage = usage.isUnlimited
      ? 100
      : Number.isFinite(balance) && balance > 0 && Number.isFinite(available)
        ? Math.min(100, Math.max(0, (available / balance) * 100))
        : 0;
    const value = usage.isUnlimited ? "∞" : formatCredits(usage.availableCredits);
    const balanceLabel = usage.isUnlimited
      ? t("desktop.wallet.unlimited", { defaultValue: "Unlimited credits" })
      : t("desktop.wallet.availableValue", {
          defaultValue: "{{value}} available",
          value,
        });

    return (
      <button
        type="button"
        onClick={() => void usage.openBillingPortal()}
        className="group flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left outline-none transition-colors hover:bg-black/[0.035] focus-visible:ring-2 focus-visible:ring-foreground/20 dark:hover:bg-white/[0.06]"
        aria-label={`${t("desktop.wallet.title", { defaultValue: "AI Credit wallet" })}: ${balanceLabel}`}
        title={t("desktop.wallet.manage", { defaultValue: "Manage billing" })}
      >
        <span className="relative grid h-8 w-8 shrink-0 place-items-center" aria-hidden="true">
          <svg className="absolute inset-0 h-8 w-8 -rotate-90" viewBox="0 0 32 32">
            <circle
              cx="16"
              cy="16"
              r="13"
              fill="none"
              pathLength="100"
              stroke="currentColor"
              strokeWidth="2"
              className="text-foreground/10 dark:text-foreground/15"
            />
            <circle
              cx="16"
              cy="16"
              r="13"
              fill="none"
              pathLength="100"
              stroke="currentColor"
              strokeDasharray="100"
              strokeDashoffset={100 - percentage}
              strokeLinecap="round"
              strokeWidth="2"
              className="text-foreground/75"
            />
          </svg>
          <span className="text-[9px] font-semibold tabular-nums text-foreground/75">
            {usage.isUnlimited ? "∞" : `${Math.round(percentage)}%`}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-foreground">
            {t("desktop.wallet.title", { defaultValue: "AI Credits" })}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{balanceLabel}</span>
        </span>
        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/65">
          {usage.plan}
        </span>
      </button>
    );
  }

  if (!usage.hasLoaded || usage.isLoading) {
    return (
      <div
        className="rounded-lg border-y border-border bg-transparent p-4"
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
    <div className="space-y-4 border-y border-border/60 bg-transparent py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">
            {t("desktop.wallet.title", { defaultValue: "AI Credit wallet" })}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("desktop.wallet.shared", {
              defaultValue: "One balance across VoiceLab products",
            })}
          </p>
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
        <div className="grid grid-cols-3 gap-3">
          <CreditValue
            label={t("desktop.wallet.balance", { defaultValue: "Balance" })}
            value={usage.isUnlimited ? "∞" : usage.balanceCredits}
          />
          <CreditValue
            label={t("desktop.wallet.available", { defaultValue: "Available" })}
            value={usage.isUnlimited ? "∞" : usage.availableCredits}
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
        <Button size="sm" variant="default" onClick={() => void usage.openBillingPortal()}>
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
