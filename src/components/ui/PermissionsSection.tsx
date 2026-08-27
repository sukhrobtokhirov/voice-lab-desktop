import { useTranslation } from "react-i18next";
import { Check, Mic, Monitor, Shield, type LucideIcon } from "lucide-react";
import type { UsePermissionsReturn } from "../../hooks/usePermissions";
import type { SystemAudioAccessResult } from "../../types/electron";
import { canManageSystemAudioInApp } from "../../utils/systemAudioAccess";

interface PermissionsSectionProps {
  permissions: UsePermissionsReturn;
  systemAudio: Pick<SystemAudioAccessResult, "granted" | "mode"> & {
    request: () => Promise<boolean>;
    isChecking?: boolean;
    enabled?: boolean;
    onEnabledChange?: (enabled: boolean) => void;
  };
}

interface PermissionToggleRowProps {
  icon: LucideIcon;
  title: string;
  description: string;
  granted: boolean;
  onRequest: () => void | Promise<unknown>;
  pending?: boolean;
  hasDivider?: boolean;
  enabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
}

function PermissionToggleRow({
  icon: Icon,
  title,
  description,
  granted,
  onRequest,
  pending = false,
  hasDivider = false,
  enabled,
  onEnabledChange,
}: PermissionToggleRowProps) {
  const isEnabled = granted && (enabled ?? true);
  const canToggle = granted && enabled !== undefined && onEnabledChange !== undefined;

  return (
    <div
      className={`flex min-h-16 items-center gap-3 px-4 py-2.5 ${
        hasDivider ? "border-t border-border" : ""
      } ${isEnabled ? "bg-foreground/[0.03]" : "bg-background"}`}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${
          isEnabled
            ? "border-foreground bg-foreground text-background"
            : "border-border bg-muted/50 text-muted-foreground"
        }`}
      >
        {isEnabled ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <Icon className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">{description}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-label={title}
        aria-checked={isEnabled}
        aria-busy={pending || undefined}
        disabled={pending || (granted && !canToggle)}
        onClick={pending ? undefined : canToggle ? () => onEnabledChange(!enabled) : granted ? undefined : onRequest}
        className={`relative ml-auto h-6 w-10 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default ${
          isEnabled
            ? "border-foreground bg-foreground"
            : "border-border bg-muted/50 hover:border-foreground/40"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full transition-[left] duration-150 ${
            isEnabled ? "left-5 bg-background" : "left-0.5 bg-muted-foreground/70"
          }`}
        />
      </button>
    </div>
  );
}

export default function PermissionsSection({ permissions, systemAudio }: PermissionsSectionProps) {
  const { t } = useTranslation();
  const platform = permissions.pasteToolsInfo?.platform;
  const isMacOS = platform === "darwin";
  const shouldShowSystemAudioPermission = canManageSystemAudioInApp(systemAudio);
  const rows = [
    {
      id: "microphone",
      icon: Mic,
      title: t("onboarding.permissions.microphoneTitle"),
      description: t("onboarding.permissions.microphoneDescription"),
      granted: permissions.micPermissionGranted,
      onRequest: permissions.requestMicPermission,
    },
    ...(isMacOS
      ? [
          {
            id: "accessibility",
            icon: Shield,
            title: t("onboarding.permissions.accessibilityTitle"),
            description: t("onboarding.permissions.accessibilityDescription"),
            granted: permissions.accessibilityPermissionGranted,
            onRequest: permissions.requestAccessibilityPermission,
          },
        ]
      : []),
    ...(shouldShowSystemAudioPermission
      ? [
          {
            id: "system-audio",
            icon: Monitor,
            title: t("onboarding.permissions.systemAudioTitle"),
            description: t("onboarding.permissions.systemAudioDescription"),
            granted: systemAudio.granted,
            onRequest: systemAudio.request,
            pending: systemAudio.isChecking,
            enabled: systemAudio.enabled,
            onEnabledChange: systemAudio.onEnabledChange,
          },
        ]
      : []),
  ];

  return (
    <section
      className="overflow-hidden rounded-lg border border-border"
      aria-label={t("onboarding.permissions.title")}
    >
      {rows.map((row, index) => (
        <PermissionToggleRow key={row.id} {...row} hasDivider={index > 0} />
      ))}
    </section>
  );
}
