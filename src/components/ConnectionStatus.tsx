import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function ConnectionStatus() {
  const { t } = useTranslation();
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const connected = () => setOnline(true);
    const disconnected = () => setOnline(false);
    window.addEventListener("online", connected);
    window.addEventListener("offline", disconnected);
    return () => {
      window.removeEventListener("online", connected);
      window.removeEventListener("offline", disconnected);
    };
  }, []);

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 top-3 z-[10020] flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-500/25 bg-[#fff8e8] px-3 py-1.5 text-sm font-medium text-amber-900 shadow-sm dark:bg-[#332b1c] dark:text-amber-200"
    >
      <WifiOff className="h-4 w-4" />
      {t("desktop.offline", {
        defaultValue: "Offline. Local dictation still works.",
      })}
    </div>
  );
}
