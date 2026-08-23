import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

interface WelcomeGreetingProps {
  name: string;
  onComplete: () => void;
}

type GreetingPhase = "blank-before" | "typing" | "holding" | "fading" | "blank-after";

const EMPTY_BEFORE_MS = 500;
const TYPE_DURATION_MS = 1200;
const HOLD_MS = 800;
const FADE_OUT_MS = 900;
const EMPTY_AFTER_MS = 500;

export default function WelcomeGreeting({ name, onComplete }: WelcomeGreetingProps) {
  const { t } = useTranslation();
  const greeting = t("desktop.onboarding.ready.greeting", { name });
  const characters = useMemo(() => Array.from(greeting), [greeting]);
  const [phase, setPhase] = useState<GreetingPhase>("blank-before");
  const [typedLength, setTypedLength] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onComplete();
      return undefined;
    }

    setPhase("blank-before");
    setTypedLength(0);
    const timer = window.setTimeout(() => setPhase("typing"), EMPTY_BEFORE_MS);

    return () => window.clearTimeout(timer);
  }, [greeting, onComplete]);

  useEffect(() => {
    if (phase !== "typing") return undefined;

    if (typedLength >= characters.length) {
      setPhase("holding");
      return undefined;
    }

    const characterDelay = Math.max(45, Math.min(90, TYPE_DURATION_MS / characters.length));
    const timer = window.setTimeout(() => setTypedLength((current) => current + 1), characterDelay);

    return () => window.clearTimeout(timer);
  }, [characters.length, phase, typedLength]);

  useEffect(() => {
    if (phase === "holding") {
      const timer = window.setTimeout(() => setPhase("fading"), HOLD_MS);
      return () => window.clearTimeout(timer);
    }

    if (phase === "fading") {
      const timer = window.setTimeout(() => setPhase("blank-after"), FADE_OUT_MS);
      return () => window.clearTimeout(timer);
    }

    if (phase === "blank-after") {
      const timer = window.setTimeout(onComplete, EMPTY_AFTER_MS);
      return () => window.clearTimeout(timer);
    }

    return undefined;
  }, [onComplete, phase]);

  const greetingVisible = phase === "typing" || phase === "holding" || phase === "fading";

  return (
    <div className="flex h-screen items-center justify-center bg-background text-foreground">
      <p className="sr-only" role="status" aria-live="polite">
        {phase === "holding" || phase === "fading" ? greeting : ""}
      </p>
      {greetingVisible && (
        <p
          aria-hidden="true"
          className={`text-3xl font-semibold tracking-tight sm:text-4xl ${
            phase === "fading" ? "welcome-greeting-exit" : ""
          }`}
        >
          {characters.slice(0, typedLength).join("")}
          {phase === "typing" && <span className="welcome-greeting-caret" />}
        </p>
      )}
    </div>
  );
}
