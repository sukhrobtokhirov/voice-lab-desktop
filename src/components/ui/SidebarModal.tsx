import React from "react";
import { useTranslation } from "react-i18next";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { SettingsLayoutProvider } from "./useSettingsLayout";

export interface SidebarItem<T extends string> {
  id: T;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group?: string;
  description?: string;
  badge?: string;
  badgeVariant?: "default" | "new" | "update" | "dot";
  shortcut?: string;
}

interface SidebarModalProps<T extends string> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  sidebarItems: SidebarItem<T>[];
  activeSection: T;
  onSectionChange: (section: T) => void;
  children: React.ReactNode;
  sidebarWidth?: string;
  version?: string;
}

export default function SidebarModal<T extends string>({
  open,
  onOpenChange,
  title,
  sidebarItems,
  activeSection,
  onSectionChange,
  children,
  sidebarWidth = "w-60",
  version,
}: SidebarModalProps<T>) {
  const { t } = useTranslation();

  const [isCompact, setIsCompact] = React.useState(false);
  const observerRef = React.useRef<ResizeObserver | null>(null);

  const containerRef = React.useCallback((el: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setIsCompact(width > 0 && width < 800);
    });
    observer.observe(el);
    observerRef.current = observer;
  }, []);

  // Group items by their group property
  const groupedItems = React.useMemo(() => {
    const groups: { label: string | null; items: SidebarItem<T>[] }[] = [];
    let currentGroup: string | null | undefined = undefined;

    for (const item of sidebarItems) {
      const group = item.group ?? null;
      if (group !== currentGroup) {
        groups.push({ label: group, items: [item] });
        currentGroup = group;
      } else {
        groups[groups.length - 1].items.push(item);
      }
    }

    return groups;
  }, [sidebarItems]);

  const renderBadge = (item: SidebarItem<T>) => {
    if (!item.badge && item.badgeVariant !== "dot") return null;

    if (item.badgeVariant === "dot") {
      return <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary shrink-0" />;
    }

    return (
      <span
        className={`ml-auto text-xs font-semibold uppercase tracking-wider px-1.5 py-px rounded-sm shrink-0 ${
          item.badgeVariant === "new"
            ? "bg-primary/10 text-primary dark:bg-primary/15"
            : item.badgeVariant === "update"
              ? "bg-warning/10 text-warning dark:bg-warning/15"
              : "bg-muted text-muted-foreground"
        }`}
      >
        {item.badge}
      </span>
    );
  };

  const actualSidebarWidth = isCompact ? "w-12" : sidebarWidth;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onEscapeKeyDown={(e) => {
            if (document.querySelector("[data-capturing]")) e.preventDefault();
          }}
          className="fixed left-[50%] top-[50%] z-50 max-h-[88vh] w-[92vw] max-w-5xl translate-x-[-50%] translate-y-[-50%] overflow-hidden rounded-[14px] border border-black/10 bg-white p-0 shadow-[0_24px_64px_-20px_rgba(0,0,0,0.3)] duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-98 data-[state=open]:zoom-in-98 dark:border-white/12 dark:bg-[#0f0f0f] dark:shadow-[0_28px_72px_-18px_rgba(0,0,0,0.7)]"
        >
          <div className="relative h-full max-h-[88vh] overflow-hidden">
            <DialogPrimitive.Close className="absolute right-5 top-[18px] z-10 grid h-7 w-7 place-items-center rounded-lg bg-transparent text-foreground/45 outline-none transition-colors hover:bg-black/[0.045] hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/20 dark:hover:bg-white/[0.07]">
              <X className="h-4 w-4" />
              <span className="sr-only">{t("common.close")}</span>
            </DialogPrimitive.Close>

            <div ref={containerRef} className="flex h-[88vh]">
              {/* Sidebar */}
              <div
                className={`${actualSidebarWidth} flex shrink-0 flex-col border-r border-black/10 bg-[#fcfcfb] transition-[width] duration-200 ease-out dark:border-white/12 dark:bg-[#171717]`}
              >
                {/* Navigation */}
                <nav
                  className={`relative flex-1 pb-2 overflow-y-auto ${
                    isCompact ? "px-1.5 pt-5" : "px-3 pt-5"
                  }`}
                >
                  {groupedItems.map((group, groupIndex) => (
                    <div key={groupIndex} className={groupIndex > 0 ? "mt-5" : ""}>
                      {!isCompact && group.label && (
                        <div className="px-2.5 pb-2 pt-1">
                          <span className="text-sm font-normal text-foreground/40 dark:text-foreground/45">
                            {group.label}
                          </span>
                        </div>
                      )}
                      <div className="space-y-px">
                        {group.items.map((item) => {
                          const Icon = item.icon;
                          const isActive = activeSection === item.id;

                          return (
                            <button
                              key={item.id}
                              data-section-id={item.id}
                              onClick={() => onSectionChange(item.id)}
                              title={isCompact ? item.label : undefined}
                              className={`group relative flex min-h-9 w-full items-center rounded-lg text-left text-sm outline-none transition-colors duration-100 ${
                                isCompact ? "justify-center px-0" : "gap-2.5 px-2.5"
                              } ${
                                isActive
                                  ? "bg-black/[0.055] font-medium text-foreground dark:bg-white/[0.08]"
                                  : "text-foreground/60 hover:bg-black/[0.035] hover:text-foreground dark:text-foreground/65 dark:hover:bg-white/[0.06]"
                              }`}
                            >
                              <div className="flex h-6 w-6 shrink-0 items-center justify-center">
                                <Icon
                                  className={`h-[18px] w-[18px] shrink-0 transition-colors duration-100 ${
                                    isActive
                                      ? "text-foreground"
                                      : "text-foreground/50 group-hover:text-foreground/80"
                                  }`}
                                />
                              </div>
                              {!isCompact && (
                                <>
                                  <span className="flex-1 truncate leading-5">
                                    {item.label}
                                  </span>
                                  {renderBadge(item)}
                                  {item.shortcut && !item.badge && (
                                    <kbd className="ml-auto text-xs text-muted-foreground/25 font-mono shrink-0">
                                      {item.shortcut}
                                    </kbd>
                                  )}
                                </>
                              )}
                              {isCompact && item.badgeVariant === "dot" && (
                                <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </nav>

                {/* Footer / version */}
                {version && (
                  <div
                    className={`border-t border-border/20 dark:border-border-subtle ${
                      isCompact ? "flex justify-center py-2.5" : "px-3 py-2.5"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <div className="h-1 w-1 rounded-full bg-success/60" />
                      {!isCompact && (
                        <span className="text-xs text-muted-foreground/40 tabular-nums tracking-wide">
                          v{version}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Main Content */}
              <div className="flex min-w-0 flex-1 flex-col bg-white dark:bg-[#0f0f0f]">
                <div className="flex h-16 shrink-0 items-center border-b border-black/10 px-6 pr-16 dark:border-white/12">
                  <DialogPrimitive.Title className="text-xl font-semibold tracking-tight text-foreground">
                    {title}
                  </DialogPrimitive.Title>
                </div>
                <SettingsLayoutProvider value={{ isCompact }}>
                  <div className={`flex-1 overflow-y-auto ${isCompact ? "p-4" : "px-8 py-7"}`}>
                    {children}
                  </div>
                </SettingsLayoutProvider>
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
