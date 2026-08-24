import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { PushNotificationCard } from "./PushNotificationCard";

interface UpdateNotificationData {
  version: string;
  releaseDate?: string;
}

const UPDATE_MESSAGE_IDS = ["betterListener", "listenHarder", "improveItself", "fixedEarly"];

function getRandomUpdateMessageId() {
  return UPDATE_MESSAGE_IDS[Math.floor(Math.random() * UPDATE_MESSAGE_IDS.length)];
}

export default function UpdateNotificationOverlay() {
  const { t } = useTranslation();
  const [data, setData] = useState<UpdateNotificationData | null>(null);
  const [messageId, setMessageId] = useState(UPDATE_MESSAGE_IDS[0]);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    let shown = false;

    const show = (d: UpdateNotificationData) => {
      if (shown) return;
      shown = true;
      setData(d);
      setMessageId(getRandomUpdateMessageId());
      setTimeout(() => {
        setIsVisible(true);
        window.electronAPI?.updateNotificationReady?.();
      }, 50);
    };

    const cleanup = window.electronAPI?.onUpdateNotificationData?.(
      (incoming: UpdateNotificationData) => show(incoming)
    );

    window.electronAPI
      ?.getUpdateNotificationData?.()
      .then((pulled: UpdateNotificationData | null) => {
        if (pulled) show(pulled);
      });

    return () => cleanup?.();
  }, []);

  const respond = useCallback(
    async (action: string) => {
      if (!data) return;
      setIsVisible(false);
      await new Promise((r) => setTimeout(r, 200));
      window.electronAPI?.updateNotificationRespond?.(action);
    },
    [data]
  );

  const handleMouseEnter = useCallback(() => {
    window.electronAPI?.setNotificationInteractivity?.(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    window.electronAPI?.setNotificationInteractivity?.(false);
  }, []);

  return (
    <div className="update-notification-window h-full w-full bg-transparent p-2">
      <PushNotificationCard
        title={t(`updateNotification.messages.${messageId}.title`)}
        description={t(`updateNotification.messages.${messageId}.description`)}
        onDismiss={() => respond("dismiss")}
        actions={
          <>
            <button
              onClick={() => respond("dismiss")}
              className="inline-flex h-6 cursor-pointer items-center rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("updateNotification.later")}
            </button>
            <button
              onClick={() => respond("update")}
              className="inline-flex h-6 cursor-pointer items-center rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 active:bg-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
            >
              {t("updateNotification.update")}
            </button>
          </>
        }
        className={[
          "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
          isVisible ? "translate-x-0 opacity-100" : "translate-x-2 opacity-0",
        ].join(" ")}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      />
    </div>
  );
}
