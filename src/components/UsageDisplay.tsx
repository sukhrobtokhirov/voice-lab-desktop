import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { useUsage } from "../hooks/useUsage";
import { useTranslation } from "react-i18next";

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

function planLabel(plan: string | null) {
  if (!plan) return null;
  return plan.replace(/[-_]+/g, " ");
}

function formatPlanPrice(
  value: { amount: string; currency: string; billingInterval: string | null } | null,
  language: string
) {
  if (!value) return null;
  const amount = Number(value.amount);
  if (!Number.isFinite(amount)) return null;
  try {
    return new Intl.NumberFormat(language, {
      style: "currency",
      currency: value.currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${value.amount} ${value.currency}`;
  }
}

export default function UsageDisplay({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const usage = useUsage();
  if (!usage) return null;

  const stt = usage.sttUsage;
  const updatedAt = formatUpdatedAt(usage.updatedAt, i18n.language);
  const label = planLabel(usage.plan);
  const price = formatPlanPrice(usage.planPrice, i18n.language);
  const percentage = stt?.daily_limit_seconds
    ? Math.min(100, Math.max(0, (stt.remaining_seconds / stt.daily_limit_seconds) * 100))
    : null;

  if (compact) {
    const secondary = stt
      ? `${formatDuration(stt.remaining_seconds)} · ${t("desktop.wallet.available")}`
      : price
        ? `${price} · ${t("desktop.wallet.shared")}`
        : t("desktop.wallet.shared");
    return (
      <button
        type="button"
        onClick={() => void usage.openBillingPortal()}
        className="group flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left outline-none transition-colors hover:bg-black/[0.035] focus-visible:ring-2 focus-visible:ring-foreground/20 dark:hover:bg-white/[0.06]"
        title={t("desktop.wallet.manage")}
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
                className="text-foreground/75"
              />
            )}
          </svg>
          <span className="text-[9px] font-semibold tabular-nums text-foreground/75">
            {percentage === null ? "VL" : `${Math.round(percentage)}%`}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-foreground">
            {label || t("desktop.wallet.title")}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{secondary}</span>
        </span>
      </button>
    );
  }

  return (
    <div className="space-y-4 border-y border-border/60 bg-transparent py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{t("desktop.wallet.title")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("desktop.wallet.shared")}</p>
        </div>
        {label && (
          <Badge variant="outline" className="capitalize">
            {label}
          </Badge>
        )}
      </div>

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

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {updatedAt ? t("desktop.wallet.updated", { time: updatedAt }) : t("desktop.wallet.live")}
        </p>
        <Button size="sm" variant="default" onClick={() => void usage.openBillingPortal()}>
          {t("desktop.wallet.manage")}
        </Button>
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
