import { RefreshCw } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useUsage, type UseUsageResult } from "../hooks/useUsage";
import type { VoiceLabUser } from "../lib/auth";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

function formatDuration(seconds: number, language: string) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  const parts: Array<{ value: number; unit: "hour" | "minute" | "second" }> = [];

  if (hours) parts.push({ value: hours, unit: "hour" });
  if (minutes) parts.push({ value: minutes, unit: "minute" });
  if (!parts.length || remainder) parts.push({ value: remainder, unit: "second" });

  return parts
    .map(({ value, unit }) =>
      new Intl.NumberFormat(language, {
        style: "unit",
        unit,
        unitDisplay: "short",
        maximumFractionDigits: 0,
      }).format(value)
    )
    .join(" ");
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
  /**
   * Lets transient surfaces (such as the profile popover) reuse an already
   * hydrated usage request instead of starting a second request on every open.
   */
  usageState?: UseUsageResult | null;
  auth?: {
    isSignedIn: boolean;
    user: VoiceLabUser | null;
  };
};

export default function UsageDisplay({
  compact = false,
  surface = "settings",
  autoRefresh = false,
  footerAction,
  usageState,
  auth,
}: UsageDisplayProps) {
  const { t, i18n } = useTranslation();
  // Keep this hook call unconditional. When a parent supplies its usage state,
  // the dormant instance never performs auth or subscription work; it only
  // preserves React's hook order while the supplied snapshot drives the UI.
  const localUsage = useUsage({
    loadOnMount: usageState === undefined,
    auth: usageState !== undefined ? { isSignedIn: false, user: null } : auth,
  });
  const usage = usageState === undefined ? localUsage : usageState;
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
      <section className="space-y-4" aria-label={t("desktop.wallet.balanceTitle")}>
        <div className="flex items-center justify-between gap-3">
          {active && entitlement ? (
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
          ) : (
            <p className="text-sm font-semibold text-foreground">{t("desktop.wallet.balanceTitle")}</p>
          )}
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
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-5">
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">{t("desktop.wallet.available")}</dt>
                <dd className="mt-1 truncate text-xl font-semibold leading-none tabular-nums text-foreground">
                  {formatDuration(entitlement.remainingSeconds, i18n.language)}
                </dd>
              </div>
              <div className="text-right">
                <dt className="text-xs text-muted-foreground">{t("desktop.wallet.dailyLimit")}</dt>
                <dd className="mt-1 text-sm font-semibold leading-none tabular-nums text-foreground">
                  {formatDuration(entitlement.usageLimitSeconds, i18n.language)}
                </dd>
              </div>
            </dl>
            <div
              className="h-1 overflow-hidden rounded-full bg-foreground/10 dark:bg-foreground/15"
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
          </>
        ) : (
          <p className="mt-4 text-sm leading-5 text-muted-foreground">
            {t("desktop.wallet.inactiveDescription")}
          </p>
        )}
      </section>
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
    <div className="space-y-4" aria-busy="true" aria-label="Loading plan usage">
      <div className="flex items-center justify-between">
        <span className="h-5 w-16 animate-pulse rounded bg-foreground/10" />
        <span className="h-8 w-20 animate-pulse rounded-lg bg-foreground/10" />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-5">
        <div className="space-y-2">
          <span className="block h-3 w-24 animate-pulse rounded bg-foreground/10" />
          <span className="block h-5 w-28 animate-pulse rounded bg-foreground/10" />
        </div>
        <div className="space-y-2 text-right">
          <span className="ml-auto block h-3 w-20 animate-pulse rounded bg-foreground/10" />
          <span className="ml-auto block h-4 w-14 animate-pulse rounded bg-foreground/10" />
        </div>
      </div>
      <span className="block h-1 w-full animate-pulse rounded-full bg-foreground/10" />
    </div>
  );
}
