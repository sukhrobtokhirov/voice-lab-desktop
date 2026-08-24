import { RefreshCw } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useUsage } from "../hooks/useUsage";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

function formatDuration(seconds: number, language: string) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  const duration = hours
    ? { hours, ...(minutes ? { minutes } : {}) }
    : minutes
      ? { minutes, ...(remainder ? { seconds: remainder } : {}) }
      : { seconds: remainder };
  const DurationFormat = (
    Intl as unknown as {
      DurationFormat?: new (
        locale: string,
        options: { style: "short" }
      ) => { format: (value: Partial<Record<"hours" | "minutes" | "seconds", number>>) => string };
    }
  ).DurationFormat;
  if (DurationFormat) return new DurationFormat(language, { style: "short" }).format(duration);
  if (hours) return `${hours}h${minutes ? ` ${minutes}m` : ""}`;
  if (minutes) return `${minutes}m${remainder ? ` ${remainder}s` : ""}`;
  return `${remainder}s`;
}

function formatCompactDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  if (hours) return `${hours}h${minutes ? ` ${minutes}m` : ""}`;
  if (minutes) return `${minutes}m${remainder ? ` ${remainder}s` : ""}`;
  return `${remainder}s`;
}

function formatResetAt(value: string | null, language: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(language, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

type UsageDisplayProps = {
  compact?: boolean;
  surface?: "settings" | "profile";
  autoRefresh?: boolean;
  footerAction?: ReactNode;
};

export default function UsageDisplay({
  compact = false,
  surface = "settings",
  autoRefresh = false,
  footerAction,
}: UsageDisplayProps) {
  const { t, i18n } = useTranslation();
  const usage = useUsage();
  const refreshUsage = usage?.refetch;

  useEffect(() => {
    if (!autoRefresh || !refreshUsage) return;
    const interval = window.setInterval(() => void refreshUsage(), 10_000);
    return () => window.clearInterval(interval);
  }, [autoRefresh, refreshUsage]);

  if (!usage) return null;

  const entitlement = usage.entitlement;
  const hasAuthoritativeEntitlement = usage.hasSubscriptionData && entitlement !== null;
  const active = entitlement?.active === true;
  const isFreePlan = entitlement?.planId === "plan_free";
  const planActionLabel = isFreePlan ? t("desktop.wallet.upgradePlan") : t("desktop.wallet.manage");
  const billingActionLabel = hasAuthoritativeEntitlement
    ? active
      ? planActionLabel
      : t("desktop.wallet.choosePlan")
    : t("desktop.wallet.manage");
  const stt = usage.sttUsage;
  const resetsAt = formatResetAt(entitlement?.resetsAt || null, i18n.language);
  const percentage = stt?.limit_seconds
    ? Math.min(100, Math.max(0, (stt.remaining_seconds / stt.limit_seconds) * 100))
    : active
      ? 100
      : null;

  if (surface === "profile") {
    if (!usage.hasLoaded) {
      return <ProfileUsageSkeleton />;
    }

    return (
      <div className="space-y-5 py-1">
        <div className="flex items-center justify-between gap-3">
          <p className="text-base font-semibold leading-5 text-foreground">
            {t("desktop.wallet.balanceTitle")}
          </p>
          <Button
            size="sm"
            variant="default"
            className="h-8 shrink-0 rounded-lg px-3 text-xs"
            onClick={() => void usage.openBillingPortal()}
            disabled={!usage.billingAvailable || usage.checkoutLoading}
          >
            {active ? t("desktop.wallet.upgradePlan") : t("desktop.wallet.choosePlan")}
          </Button>
        </div>

        {active && entitlement ? (
          <>
            <dl className="space-y-3 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">{t("desktop.wallet.total")}</dt>
                <dd className="shrink-0 text-right font-medium tabular-nums text-foreground">
                  {formatCompactDuration(entitlement.usageLimitSeconds)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">{t("desktop.wallet.remaining")}</dt>
                <dd className="shrink-0 text-right font-medium tabular-nums text-foreground">
                  {formatCompactDuration(entitlement.remainingSeconds)}
                </dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="text-sm leading-5 text-muted-foreground">
            {t("desktop.wallet.inactiveDescription")}
          </p>
        )}
      </div>
    );
  }

  if (compact) {
    const needsEntitlementRefresh = !hasAuthoritativeEntitlement;
    const compactLoading = usage.checkoutLoading || usage.isLoading || usage.isRefreshing;
    const secondary = compactLoading
      ? t("desktop.wallet.checking")
      : active && stt
        ? t("desktop.wallet.remainingCompact", {
            duration: formatDuration(stt.remaining_seconds, i18n.language),
          })
        : active && entitlement
          ? t("desktop.wallet.dailyCompact", {
              duration: formatDuration(entitlement.usageLimitSeconds, i18n.language),
            })
          : t("desktop.wallet.choosePlan");
    const handleCompactClick = () => {
      if (needsEntitlementRefresh) {
        void usage.refetch();
        return;
      }
      void usage.openBillingPortal();
    };
    return (
      <button
        type="button"
        onClick={handleCompactClick}
        disabled={compactLoading || (!needsEntitlementRefresh && !usage.billingAvailable)}
        className="group flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left outline-none transition-colors hover:bg-black/[0.035] focus-visible:ring-2 focus-visible:ring-foreground/20 disabled:cursor-default disabled:opacity-65 dark:hover:bg-white/[0.06]"
        title={
          needsEntitlementRefresh
            ? t("desktop.wallet.refresh")
            : active
              ? planActionLabel
              : t("desktop.wallet.choosePlan")
        }
      >
        <span className="relative grid h-9 w-9 shrink-0 place-items-center" aria-hidden="true">
          <svg className="absolute inset-0 h-9 w-9 -rotate-90" viewBox="0 0 36 36">
            <circle
              cx="18"
              cy="18"
              r="15"
              fill="none"
              pathLength="100"
              stroke="currentColor"
              strokeWidth="2"
              className="text-foreground/10 dark:text-foreground/15"
            />
            {percentage !== null && (
              <circle
                cx="18"
                cy="18"
                r="15"
                fill="none"
                pathLength="100"
                stroke="currentColor"
                strokeDasharray="100"
                strokeDashoffset={100 - percentage}
                strokeLinecap="round"
                strokeWidth="2"
                className={active ? "text-emerald-500/80" : "text-foreground/75"}
              />
            )}
          </svg>
          <span className="text-2xs font-semibold leading-none tabular-nums text-foreground/75">
            {compactLoading ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : needsEntitlementRefresh ? (
              <RefreshCw className="h-3 w-3" />
            ) : percentage === null ? (
              "VL"
            ) : (
              `${Math.round(percentage)}%`
            )}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium leading-5 text-foreground">
            {active
              ? entitlement.planName || usage.plan || t("desktop.wallet.activePlan")
              : t("desktop.wallet.noActivePlan")}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{secondary}</span>
        </span>
      </button>
    );
  }

  return (
    <div className="space-y-3 bg-transparent py-4">
      {active && entitlement && (
        <div className="space-y-4 rounded-xl border border-border/60 p-4">
          <div className="flex items-center">
            <Badge
              variant="outline"
              className={
                isFreePlan
                  ? "border-border bg-muted/70 text-muted-foreground"
                  : "border-coral/30 bg-coral/10 text-coral dark:border-coral/35 dark:bg-coral/15"
              }
            >
              {entitlement.planName || usage.plan || t("desktop.wallet.activePlan")}
            </Badge>
          </div>
          <div className="space-y-2.5">
            <div className="flex items-end justify-between gap-6">
              <div>
                <p className="text-xs text-muted-foreground">
                  {t("desktop.wallet.available")}
                </p>
                <p className="mt-1 text-xl font-semibold leading-none tabular-nums text-foreground">
                  {formatDuration(entitlement.remainingSeconds, i18n.language)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">
                  {t("desktop.wallet.dailyLimit")}
                </p>
                <p className="mt-1 text-sm font-medium tabular-nums text-foreground">
                  {formatDuration(entitlement.usageLimitSeconds, i18n.language)}
                </p>
              </div>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-foreground/10 dark:bg-foreground/15"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={entitlement.usageLimitSeconds}
              aria-valuenow={entitlement.usedSeconds}
              aria-label={t("desktop.wallet.balance")}
            >
              <div
                className="h-full rounded-full bg-foreground/70 transition-[width] duration-200 dark:bg-foreground/80"
                style={{
                  width: `${Math.min(
                    100,
                    Math.max(0, (entitlement.usedSeconds / entitlement.usageLimitSeconds) * 100)
                  )}%`,
                }}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                {t("desktop.wallet.balance")} {formatDuration(entitlement.usedSeconds, i18n.language)}
              </span>
              {resetsAt && <span>{t("desktop.wallet.resetsOn", { date: resetsAt })}</span>}
            </div>
          </div>
        </div>
      )}

      {usage.error && (
        <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">
          <p>{usage.error}</p>
          {usage.errorRequestId && (
            <p className="mt-1 font-mono text-xs opacity-80">{usage.errorRequestId}</p>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        {footerAction}
        <Button
          size="sm"
          variant="default"
          className="h-8 px-3 text-xs"
          onClick={() => void usage.openBillingPortal()}
          disabled={!usage.billingAvailable || usage.checkoutLoading}
        >
          {usage.checkoutLoading ? t("desktop.wallet.checking") : billingActionLabel}
        </Button>
      </div>
    </div>
  );
}

function ProfileUsageSkeleton() {
  return (
    <div className="space-y-5 py-1" aria-busy="true" aria-label="Loading plan usage">
      <div className="flex items-center justify-between">
        <span className="h-5 w-16 animate-pulse rounded bg-foreground/10" />
        <span className="h-8 w-20 animate-pulse rounded-lg bg-foreground/10" />
      </div>
      <div className="space-y-3">
        {[0, 1].map((index) => (
          <div key={index} className="flex items-center justify-between gap-4">
            <span className="h-4 w-16 animate-pulse rounded bg-foreground/10" />
            <span className="h-4 w-14 animate-pulse rounded bg-foreground/10" />
          </div>
        ))}
      </div>
      <span className="block h-4 w-44 animate-pulse rounded bg-foreground/10" />
    </div>
  );
}
