import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUsage, type DesktopPricingPlan } from "../hooks/useUsage";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${remainder}s`;
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

function formatDate(value: string | null, language: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(language, {
    year: "numeric",
    month: "short",
    day: "numeric",
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
  const active = entitlement?.active === true;
  const stt = usage.sttUsage;
  const offer = usage.plans[0] || null;
  const offerPrice = offer ? formatPrice(offer, i18n.language) : null;
  const updatedAt = formatUpdatedAt(usage.updatedAt, i18n.language);
  const periodEnd = formatDate(entitlement?.periodEndsAt || null, i18n.language);
  const percentage = stt?.daily_limit_seconds
    ? Math.min(100, Math.max(0, (stt.remaining_seconds / stt.daily_limit_seconds) * 100))
    : active
      ? 100
      : null;
  const interval = offer
    ? formatInterval(offer.billingInterval, offer.billingIntervalCount, t)
    : null;

  if (compact) {
    const secondary = usage.checkoutLoading
      ? t("desktop.wallet.checking")
      : active && stt
        ? t("desktop.wallet.remainingCompact", {
            duration: formatDuration(stt.remaining_seconds),
          })
        : active && entitlement
          ? t("desktop.wallet.dailyCompact", {
              duration: formatDuration(entitlement.dailySeconds),
            })
          : usage.pricingEnabled === false
            ? t("desktop.wallet.billingDisabled")
            : offerPrice
              ? t("desktop.wallet.priceCompact", {
                  price: offerPrice,
                  interval: interval || "",
                })
              : usage.isLoading
                ? t("desktop.wallet.checking")
                : t("desktop.wallet.noActivePlan");
    return (
      <button
        type="button"
        onClick={() => void usage.openBillingPortal()}
        disabled={!usage.billingAvailable || usage.checkoutLoading}
        className="group flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left outline-none transition-colors hover:bg-black/[0.035] focus-visible:ring-2 focus-visible:ring-foreground/20 disabled:cursor-default disabled:opacity-65 dark:hover:bg-white/[0.06]"
        title={active ? t("desktop.wallet.manage") : t("desktop.wallet.choosePlan")}
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
            {percentage !== null && (
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
                className={active ? "text-emerald-500/80" : "text-foreground/75"}
              />
            )}
          </svg>
          <span className="text-[9px] font-semibold tabular-nums text-foreground/75">
            {usage.checkoutLoading ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : percentage === null ? (
              "VL"
            ) : (
              `${Math.round(percentage)}%`
            )}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-foreground">
            {active
              ? entitlement.packageName || usage.plan || t("desktop.wallet.activePlan")
              : t("desktop.wallet.noActivePlan")}
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
            {active
              ? t("desktop.wallet.activeDescription")
              : t("desktop.wallet.inactiveDescription")}
          </p>
        </div>
        <Badge variant={active ? "success" : "outline"}>
          {active ? t("desktop.wallet.active") : t("desktop.wallet.inactive")}
        </Badge>
      </div>

      {active && entitlement && (
        <div className="space-y-3 rounded-xl border border-border/60 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium text-foreground">
              {entitlement.packageName || usage.plan || t("desktop.wallet.activePlan")}
            </p>
            {usage.planPrice && (
              <span className="text-sm text-muted-foreground">
                {formatMoney(usage.planPrice.amount, usage.planPrice.currency, i18n.language)}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <UsageValue
              label={t("desktop.wallet.dailyLimit")}
              value={formatDuration(entitlement.dailySeconds)}
            />
            <UsageValue
              label={t("desktop.wallet.maxRecording")}
              value={formatDuration(entitlement.maxRequestSeconds)}
            />
          </div>
          {periodEnd && (
            <p className="text-xs text-muted-foreground">
              {entitlement.cancelAtPeriodEnd
                ? t("desktop.wallet.endsOn", { date: periodEnd })
                : t("desktop.wallet.renewsOn", { date: periodEnd })}
            </p>
          )}
        </div>
      )}

      {stt && (
        <div className="grid grid-cols-3 gap-3">
          <UsageValue
            label={t("desktop.wallet.balance")}
            value={formatDuration(stt.used_seconds)}
          />
          <UsageValue
            label={t("desktop.wallet.available")}
            value={formatDuration(stt.remaining_seconds)}
          />
          <UsageValue
            label={t("desktop.wallet.reserved")}
            value={formatDuration(stt.daily_limit_seconds)}
          />
        </div>
      )}

      {!active && usage.pricingEnabled === true && usage.plans.length > 0 && (
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

      {usage.pricingEnabled === false && !active && (
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
            disabled={usage.isLoading || usage.checkoutLoading}
          >
            <RefreshCw
              className={`mr-1.5 h-3.5 w-3.5 ${usage.isLoading || usage.checkoutLoading ? "animate-spin" : ""}`}
            />
            {usage.isLoading || usage.checkoutLoading
              ? t("desktop.wallet.refreshing")
              : t("desktop.wallet.refresh")}
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={() => void usage.openBillingPortal()}
            disabled={!usage.billingAvailable || usage.checkoutLoading}
          >
            {active ? t("desktop.wallet.manage") : t("desktop.wallet.choosePlan")}
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
