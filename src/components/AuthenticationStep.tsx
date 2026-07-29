import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, ArrowUpRight, Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { signInWithSocial } from "../lib/auth";
import { Button } from "./ui/button";
import logoIcon from "../assets/icon.png";

interface AuthenticationStepProps {
  onContinueWithoutAccount: () => void;
  onAuthComplete: () => void;
  onNeedsVerification?: (email: string) => void;
}

export default function AuthenticationStep({
  onContinueWithoutAccount,
  onAuthComplete,
}: AuthenticationStepProps) {
  const { t } = useTranslation();
  const { isSignedIn, isLoaded, user, authStatus, authErrorCode } = useAuth();
  const [opening, setOpening] = useState(false);
  const [protocolReady, setProtocolReady] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI?.getOAuthProtocolRegistered?.().then(setProtocolReady).catch(() => setProtocolReady(false));
  }, []);

  useEffect(() => {
    if (isLoaded && isSignedIn && user?.id && user?.email) onAuthComplete();
  }, [isLoaded, isSignedIn, onAuthComplete, user]);

  useEffect(() => {
    if (["opening", "waiting", "exchanging", "opening-browser", "waiting-for-browser"].includes(authStatus)) return;
    setOpening(false);
    if (["cancelled", "signed-out"].includes(authStatus)) {
      setError(
        authStatus === "cancelled"
          ? t("auth.desktopCancelled", {
              defaultValue: "Kirish bekor qilindi. Xohlasangiz qayta urinib ko‘ring.",
            })
          : null
      );
    } else if (authStatus === "error" || authStatus === "expired") {
      setError(
        authStatus === "expired"
          ? t("auth.desktopExpired", {
              defaultValue: "Sessiya tugadi. Brauzer orqali qayta kiring.",
            })
          : t("auth.desktopFailed", {
              defaultValue: "Kirish yakunlanmadi. Qayta urinib ko‘ring.",
            })
      );
    }
  }, [authErrorCode, authStatus, t]);

  const start = useCallback(async () => {
    setOpening(true);
    setError(null);
    const result = await signInWithSocial("google");
    if (result.error) {
      setOpening(false);
      setError(result.error.message);
    }
  }, []);

  return (
    <div className="space-y-5">
      <div className="text-center">
        <img src={logoIcon} alt="VoiceLab" className="mx-auto mb-3 h-12 w-12 rounded-xl" />
        <h2 className="text-xl font-semibold">{t("auth.signIn", { defaultValue: "VoiceLab hisobiga kiring" })}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("auth.desktopBrowserHint", { defaultValue: "Xavfsiz kirish brauzerda ochiladi va tugagach ilovaga qaytadi." })}
        </p>
      </div>

      <div className="rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <div className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#e55347]" />Kirish ma’lumotlari ilovaning himoyalangan xotirasida saqlanadi.</div>
      </div>

      {error && (
        <div role="alert" className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}
        </div>
      )}

      {!protocolReady && <p className="text-sm text-destructive">Ilovaga qaytish havolasi ishlamayapti. VoiceLab Dictate’ni qayta ochib, yana urinib ko‘ring.</p>}

      <Button className="h-11 w-full" onClick={start} disabled={opening || !protocolReady}>
        {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
        {opening ? "Brauzerda tasdiqlang…" : "Brauzer orqali kirish"}
      </Button>
      <button type="button" onClick={onContinueWithoutAccount} className="w-full text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
        Advanced setup
      </button>
    </div>
  );
}
