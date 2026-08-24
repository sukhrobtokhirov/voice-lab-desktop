import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { MeetingNotificationCard } from "./MeetingNotificationCard";

type PromptVariant = "detected" | "starting" | "underway";

interface NotificationData {
  detectionId: string;
  source: string;
  key: string;
  event: { summary?: string | null } | null;
  variant: PromptVariant;
  joinUrl: string | null;
}

export default function MeetingNotificationOverlay() {
  const { t } = useTranslation();
  const [data, setData] = useState<NotificationData | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    let shown = false;

    const show = (d: NotificationData) => {
      if (shown) return;
      shown = true;
      setData(d);
      setTimeout(() => {
        setIsVisible(true);
        window.electronAPI?.meetingNotificationReady?.();
      }, 50);
    };

    const cleanup = window.electronAPI?.onMeetingNotificationData?.((incoming: NotificationData) =>
      show(incoming)
    );

    window.electronAPI?.getMeetingNotificationData?.().then((pulled: NotificationData | null) => {
      if (pulled) show(pulled);
    });

    return () => cleanup?.();
  }, []);

  const respond = useCallback(
    async (action: string) => {
      if (!data) return;
      setIsVisible(false);
      await new Promise((r) => setTimeout(r, 200));
      window.electronAPI?.meetingNotificationRespond?.(data.detectionId, action);
    },
    [data]
  );

  const handleMouseEnter = useCallback(() => {
    window.electronAPI?.setNotificationInteractivity?.(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    window.electronAPI?.setNotificationInteractivity?.(false);
  }, []);

  const variant: PromptVariant = data?.variant ?? "detected";
  const title = (variant !== "detected" && data?.event?.summary) || t("meetingNotification.title");

  return (
    <div className="meeting-notification-window h-full w-full bg-transparent p-2">
      <MeetingNotificationCard
        title={title}
        body={t(`meetingNotification.body.${variant}`)}
        startLabel={data?.joinUrl ? t("meetingNotification.join") : t("meetingNotification.start")}
        onStart={() => respond(data?.joinUrl ? "join" : "start")}
        onDismiss={() => respond("dismiss")}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={[
          "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
          isVisible
            ? "translate-x-0 opacity-100"
            : "translate-x-2 opacity-0",
        ].join(" ")}
      />
    </div>
  );
}
