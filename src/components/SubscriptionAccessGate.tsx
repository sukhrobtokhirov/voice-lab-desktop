import type { ReactNode } from "react";
import { CreditCard, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useUsage } from "../hooks/useUsage";
import WindowControls from "./WindowControls";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";

function formatPlanPrice(value: string | null, currency: string, language: string) {
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

export default function SubscriptionAccessGate({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const usage = useUsage();

  if (usage?.entitlement?.active === true) return children;

  // A failed entitlement request has completed, even though it did not yield
  // usable subscription data. Keep the gate closed and show the exact error
  // with a retry action instead of leaving the user on an endless spinner.
  const loading = !usage || usage.isLoading || (!usage.hasSubscriptionData && !usage.error);
  const offer = usage?.plans[0] || null;
  const price = offer ? formatPlanPrice(offer.priceUsd, offer.currency, i18n.language) : null;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex h-10 shrink-0 items-center justify-end border-b border-border px-2 [app-region:drag]">
        <div className="[app-region:no-drag]">
          <WindowControls />
        </div>
      </div>
      <main className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-8">
        <Card className="w-full max-w-md rounded-2xl border-border/60 shadow-lg">
          <CardContent className="space-y-5 p-6">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/10">
              {loading ? (
                <RefreshCw className="h-5 w-5 animate-spin text-primary" />
              ) : (
                <CreditCard className="h-5 w-5 text-primary" />
              )}
            </div>
            <div className="text-center">
              <h1 className="text-xl font-semibold">
                {loading ? t("desktop.wallet.checking") : t("desktop.subscriptionPrompt.title")}
              </h1>
              {!loading && (
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {t("desktop.subscriptionPrompt.description")}
                </p>
              )}
            </div>

            {!loading && offer && (
              <div className="rounded-xl border border-border/60 bg-muted/35 p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-semibold">{offer.name}</p>
                  {price && (
                    <p className="whitespace-nowrap text-sm font-semibold">
                      {t("desktop.wallet.priceCompact", {
                        price,
                        interval: offer.billingInterval
                          ? t(`desktop.wallet.intervals.${offer.billingInterval}`, {
                              defaultValue: offer.billingInterval,
                            })
                          : "",
                      })}
                    </p>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {offer.dailyMinutes !== null && (
                    <span>{t("desktop.wallet.dailyMinutes", { count: offer.dailyMinutes })}</span>
                  )}
                  {offer.maxRecordingSeconds !== null && (
                    <span>
                      {t("desktop.wallet.maxRecordingSeconds", {
                        count: offer.maxRecordingSeconds,
                      })}
                    </span>
                  )}
                </div>
              </div>
            )}

            {!loading && usage?.error && (
              <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">
                <p>{usage.error}</p>
                {usage.errorRequestId && (
                  <code className="mt-1 block break-all text-xs opacity-80">
                    {usage.errorRequestId}
                  </code>
                )}
              </div>
            )}

            {!loading && (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={() => void usage?.refetch()}
                  disabled={usage?.isLoading || usage?.checkoutLoading}
                >
                  <RefreshCw className="mr-1.5 h-4 w-4" />
                  {t("desktop.wallet.refresh")}
                </Button>
                <Button
                  onClick={() => void usage?.openCheckout()}
                  disabled={!usage?.billingAvailable || usage?.checkoutLoading}
                >
                  {usage?.checkoutLoading
                    ? t("desktop.wallet.checking")
                    : t("desktop.wallet.choosePlan")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
