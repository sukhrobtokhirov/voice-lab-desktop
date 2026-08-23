import React, { Suspense, useCallback, useEffect, useState } from "react";
import App from "./App.jsx";
import AuthenticationStep from "./components/AuthenticationStep.tsx";
import MeetingNotificationOverlay from "./components/MeetingNotificationOverlay.tsx";
import TranscriptionPreviewOverlay from "./components/TranscriptionPreviewOverlay.tsx";
import UpdateNotificationOverlay from "./components/UpdateNotificationOverlay.tsx";
import WindowControls from "./components/WindowControls.tsx";
import { Card, CardContent } from "./components/ui/card.tsx";
import { Skeleton } from "./components/ui/skeleton.tsx";
import { useAuth } from "./hooks/useAuth";
import { useTheme } from "./hooks/useTheme";
import ConnectionStatus from "./components/ConnectionStatus";
import WelcomeGreeting from "./components/WelcomeGreeting.tsx";
import { hasOnboardingProgress } from "./constants/onboarding";

const ControlPanel = React.lazy(() => import("./components/ControlPanel.tsx"));
const OnboardingFlow = React.lazy(() => import("./components/OnboardingFlow.tsx"));
const AgentOverlay = React.lazy(() => import("./components/AgentOverlay.tsx"));

export default function AppRouter() {
  useTheme();
  const params = window.location.search;

  if (params.includes("meeting-notification=true")) {
    return <MeetingNotificationOverlay />;
  }

  if (params.includes("update-notification=true")) {
    return <UpdateNotificationOverlay />;
  }

  if (params.includes("transcription-preview=true")) {
    return <TranscriptionPreviewOverlay />;
  }

  return <MainApp />;
}

function MainApp() {
  const { isSignedIn, isGracePeriodOnly, isLoaded: authLoaded, user } = useAuth();

  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showWelcomeGreeting, setShowWelcomeGreeting] = useState(false);
  const [isControlPanelEntering, setIsControlPanelEntering] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [postOnboardingSettingsSection, setPostOnboardingSettingsSection] = useState(undefined);

  const isAgentPanel = window.location.search.includes("agent=true");
  const isControlPanel =
    !isAgentPanel &&
    (window.location.pathname.includes("control") || window.location.search.includes("panel=true"));
  const isDictationPanel = !isControlPanel && !isAgentPanel;

  useEffect(() => {
    if (isAgentPanel) {
      import("./components/AgentOverlay.tsx").catch(() => {});
    } else if (isControlPanel) {
      import("./components/ControlPanel.tsx").catch(() => {});

      if (!localStorage.getItem("onboardingCompleted")) {
        import("./components/OnboardingFlow.tsx").catch(() => {});
      }
    }
  }, [isAgentPanel, isControlPanel]);

  useEffect(() => {
    if (!authLoaded) return;

    const onboardingCompleted = localStorage.getItem("onboardingCompleted") === "true";
    localStorage.removeItem("authenticationSkipped");
    localStorage.removeItem("skipAuth");
    const onboardingInProgress = hasOnboardingProgress();
    const isReturningUser =
      !onboardingCompleted && isSignedIn && !isGracePeriodOnly && !onboardingInProgress;

    if (isReturningUser) {
      localStorage.setItem("onboardingCompleted", "true");
    }

    const resolved = localStorage.getItem("onboardingCompleted") === "true";

    if (isControlPanel) {
      if (!resolved) {
        setShowOnboarding(true);
        setShowWelcomeGreeting(false);
      } else {
        setShowOnboarding(false);
      }
    }

    if (isDictationPanel && !resolved) {
      // Keep the dictation overlay hidden during onboarding — OnboardingFlow
      // shows it explicitly when the user reaches the activation step.
      window.electronAPI?.hideWindow?.();
    }

    setIsLoading(false);
  }, [authLoaded, isControlPanel, isDictationPanel, isGracePeriodOnly, isSignedIn]);

  const handleOnboardingComplete = useCallback(
    (options) => {
      if (options?.openSettings) {
        setPostOnboardingSettingsSection("transcription");
      }
      setShowOnboarding(false);
      localStorage.setItem("onboardingCompleted", "true");
      if (isSignedIn) {
        setShowWelcomeGreeting(true);
      }
    },
    [isSignedIn]
  );

  const handleWelcomeGreetingComplete = useCallback(() => {
    setShowWelcomeGreeting(false);
    setIsControlPanelEntering(true);
  }, []);

  useEffect(() => {
    if (!isControlPanelEntering) return undefined;

    const timer = window.setTimeout(() => setIsControlPanelEntering(false), 1000);
    return () => window.clearTimeout(timer);
  }, [isControlPanelEntering]);

  if (isAgentPanel) {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <AgentOverlay />
      </Suspense>
    );
  }

  if (isLoading) {
    return <LoadingFallback />;
  }

  // First-run onboarding is intentionally shown before authentication. People
  // should understand VoiceLab and choose to sign in, rather than being sent
  // to a browser as soon as the app opens.
  if (isControlPanel && showOnboarding) {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <OnboardingFlow onComplete={handleOnboardingComplete} />
      </Suspense>
    );
  }

  if (isControlPanel && showWelcomeGreeting && isSignedIn) {
    const greetingName = user?.name?.trim() || user?.email?.split("@")[0] || "VoiceLab";
    return <WelcomeGreeting name={greetingName} onComplete={handleWelcomeGreetingComplete} />;
  }

  // Returning signed-out users still receive the account gate before the
  // dashboard, based on the live main-process auth state.
  if (isControlPanel && authLoaded && !isSignedIn) {
    return (
      <div
        className="h-screen flex flex-col bg-background"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div
          className="flex items-center justify-end w-full h-10 shrink-0"
          style={{ WebkitAppRegion: "drag" }}
        >
          {window.electronAPI?.getPlatform?.() !== "darwin" && (
            <div className="pr-1" style={{ WebkitAppRegion: "no-drag" }}>
              <WindowControls />
            </div>
          )}
        </div>
        <div className="flex-1 px-6 overflow-y-auto flex items-center">
          <div className="w-full max-w-sm mx-auto">
            <Card className="border border-border bg-card shadow-sm">
              <CardContent className="p-6">
                <AuthenticationStep onAuthComplete={() => {}} onNeedsVerification={() => {}} />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return isControlPanel ? (
    <Suspense fallback={<LoadingFallback />}>
      <div className={isControlPanelEntering ? "app-content-in" : undefined}>
        <ControlPanel initialSettingsSection={postOnboardingSettingsSection} />
      </div>
    </Suspense>
  ) : (
    <App />
  );
}

function LoadingFallback({ message }) {
  const fallbackMessage = message || null;

  return (
    <div
      className="min-h-screen bg-background px-5 py-6 text-foreground"
      aria-busy="true"
      aria-label={fallbackMessage || "Loading content"}
    >
      <ConnectionStatus />
      <div className="mx-auto flex w-full max-w-4xl gap-5">
        <aside className="hidden w-56 shrink-0 border-r border-border pr-5 sm:block">
          <Skeleton className="h-8 w-full" />
          <div className="mt-7 space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-4/5" />
          </div>
        </aside>
        <main className="min-w-0 flex-1 space-y-4 pt-1">
          <Skeleton className="h-5 w-32" />
          {[0, 1, 2].map((row) => (
            <div key={row} className="rounded-lg border border-border p-4">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="mt-3 h-3 w-full" />
              <Skeleton className="mt-2 h-3 w-3/5" />
            </div>
          ))}
        </main>
      </div>
    </div>
  );
}
