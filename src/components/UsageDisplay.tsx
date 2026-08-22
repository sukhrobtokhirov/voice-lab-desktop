import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUsage, type DesktopPricingPlan } from "../hooks/useUsage";
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

function formatUpdatedAt(value: string | null, language: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(language, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatResetAt(value: string | null, language: string, usageWindow: "hour" | "day") {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(language, {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(usageWindow === "hour" ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function formatMoney(value: string | null, currency: string, language: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  try {
    return new Intl.NumberFormat(language, {
      style: "currency",
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${value} ${currency}`;
  }
}

function formatPrice(plan: DesktopPricingPlan, language: string) {
  return formatMoney(plan.priceUsd, plan.currency, language);
}

function formatInterval(
  interval: string | null,
  count: number | null,
  translate: (key: string, options?: Record<string, unknown>) => string
) {
  if (!interval) return null;
  const unit = translate(`desktop.wallet.intervals.${interval}`, { defaultValue: interval });
  return count && count > 1 ? `${count} ${unit}` : unit;
}

export default function UsageDisplay({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const usage = useUsage();
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
  const updatedAt = formatUpdatedAt(usage.updatedAt, i18n.language);
  const usageWindow = entitlement?.usageWindow || stt?.usage_window || "day";
  const resetsAt = formatResetAt(entitlement?.resetsAt || null, i18n.language, usageWindow);
  const usageLimitLabel =
    usageWindow === "hour" ? t("desktop.wallet.hourlyLimit") : t("desktop.wallet.dailyLimit");
  const percentage = stt?.limit_seconds
    ? Math.min(100, Math.max(0, (stt.remaining_seconds / stt.limit_seconds) * 100))
    : active
      ? 100
      : null;

  if (compact) {
    const needsEntitlementRefresh = !hasAuthoritativeEntitlement;
    const compactLoading = usage.checkoutLoading || usage.isLoading || usage.isRefreshing;
    const secondary = compactLoading
      ? t("desktop.wallet.checking")
      : active && stt
        ? t(
            usageWindow === "hour"
              ? "desktop.wallet.remainingHourCompact"
              : "desktop.wallet.remainingCompact",
            {
              duration: formatDuration(stt.remaining_seconds, i18n.language),
            }
          )
        : active && entitlement
          ? t(
              usageWindow === "hour"
                ? "desktop.wallet.hourlyCompact"
                : "desktop.wallet.dailyCompact",
              {
                duration: formatDuration(entitlement.usageLimitSeconds, i18n.language),
              }
            )
        : t("desktop.wallet.unavailable");
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
              : t("desktop.wallet.title")}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{secondary}</span>
        </span>
      </button>
    );
  }

  return (
    <div className="space-y-4 border-y border-border/60 bg-transparent py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{t("desktop.wallet.title")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {!hasAuthoritativeEntitlement
              ? usage.isLoading || usage.isRefreshing || !usage.hasLoaded
                ? t("desktop.wallet.checking")
                : t("desktop.wallet.unavailable")
              : active
              ? t("desktop.wallet.activeDescription")
              : t("desktop.wallet.inactiveDescription")}
          </p>
        </div>
        <Badge variant={hasAuthoritativeEntitlement && active ? "success" : "outline"}>
          {!hasAuthoritativeEntitlement
            ? usage.isLoading || usage.isRefreshing || !usage.hasLoaded
              ? t("desktop.wallet.checking")
              : t("desktop.wallet.unavailable")
            : active
              ? t("desktop.wallet.active")
              : t("desktop.wallet.inactive")}
        </Badge>
      </div>

      {active && entitlement && (
        <div className="space-y-3 rounded-xl border border-border/60 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium text-foreground">
              {entitlement.planName || usage.plan || t("desktop.wallet.activePlan")}
            </p>
            {usage.planPrice && (
              <span className="text-sm text-muted-foreground">
                {formatMoney(usage.planPrice.amount, usage.planPrice.currency, i18n.language)}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <UsageValue
              label={usageLimitLabel}
              value={formatDuration(entitlement.usageLimitSeconds, i18n.language)}
            />
            <UsageValue
              label={t("desktop.wallet.maxRecording")}
              value={formatDuration(entitlement.maxRequestSeconds, i18n.language)}
            />
          </div>
          {resetsAt && (
            <p className="text-xs text-muted-foreground">
              {t("desktop.wallet.resetsOn", { date: resetsAt })}
            </p>
          )}
        </div>
      )}

      {stt && (
        <div className="grid grid-cols-3 gap-3">
          <UsageValue
            label={t(
              usageWindow === "hour" ? "desktop.wallet.usedThisHour" : "desktop.wallet.balance"
            )}
            value={formatDuration(stt.used_seconds, i18n.language)}
          />
          <UsageValue
            label={t(
              usageWindow === "hour"
                ? "desktop.wallet.remainingThisHour"
                : "desktop.wallet.available"
            )}
            value={formatDuration(stt.remaining_seconds, i18n.language)}
          />
          <UsageValue
            label={usageLimitLabel}
            value={formatDuration(stt.limit_seconds, i18n.language)}
          />
        </div>
      )}

      {hasAuthoritativeEntitlement &&
        !active &&
        usage.pricingEnabled === true &&
        usage.plans.length > 0 && (
        <div className="space-y-2">
          {usage.plans.map((plan) => {
            const price = formatPrice(plan, i18n.language);
            const planInterval = formatInterval(plan.billingInterval, plan.billingIntervalCount, t);
            return (
              <div key={plan.code} className="rounded-xl border border-border/60 p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-foreground">{plan.name}</p>
                  {price && (
                    <p className="whitespace-nowrap text-sm font-semibold text-foreground">
                      {t("desktop.wallet.priceCompact", {
                        price,
                        interval: planInterval || "",
                      })}
                    </p>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {plan.dailyMinutes !== null && (
                    <span>{t("desktop.wallet.dailyMinutes", { count: plan.dailyMinutes })}</span>
                  )}
                  {plan.maxRecordingSeconds !== null && (
                    <span>
                      {t("desktop.wallet.maxRecordingSeconds", {
                        count: plan.maxRecordingSeconds,
                      })}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasAuthoritativeEntitlement && usage.pricingEnabled === false && !active && (
        <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
          {t("desktop.wallet.billingDisabled")}
        </p>
      )}

      {usage.error && (
        <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">
          <p>{usage.error}</p>
          {usage.errorRequestId && (
            <p className="mt-1 font-mono text-xs opacity-80">{usage.errorRequestId}</p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {usage.checkoutLoading
            ? t("desktop.wallet.checking")
            : updatedAt
              ? t("desktop.wallet.updated", { time: updatedAt })
              : t("desktop.wallet.refreshHint")}
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void usage.refetch()}
            disabled={usage.isLoading || usage.isRefreshing || usage.checkoutLoading}
          >
            <RefreshCw
              className={`mr-1.5 h-3.5 w-3.5 ${usage.isLoading || usage.isRefreshing || usage.checkoutLoading ? "animate-spin" : ""}`}
            />
            {usage.isLoading || usage.isRefreshing || usage.checkoutLoading
              ? t("desktop.wallet.refreshing")
              : t("desktop.wallet.refresh")}
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={() => void usage.openBillingPortal()}
            disabled={!usage.billingAvailable || usage.checkoutLoading}
          >
            {billingActionLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function UsageValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}
