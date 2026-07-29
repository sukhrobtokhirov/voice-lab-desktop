import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import {
  DESKTOP_LANGUAGE_CATALOG,
  languageUnsupportedReason,
  providerSupportsLanguage,
  type DesktopLanguageCapabilities,
  type DesktopLanguageProvider,
} from "../../config/desktopLanguages";

export interface LanguageOption {
  value: string;
  label: string;
  flag: string;
  localizedName?: string;
  group?: "automatic" | "central-asia" | "other";
  disabled?: boolean;
  disabledReason?: string;
}

export function getDesktopLanguageOptions(
  provider: DesktopLanguageProvider,
  capabilities?: DesktopLanguageCapabilities
): LanguageOption[] {
  return DESKTOP_LANGUAGE_CATALOG.map((language) => ({
    value: language.code,
    label: language.label,
    localizedName: language.localizedName,
    flag: language.flag,
    group: language.group,
    disabled: !providerSupportsLanguage(provider, language.code, capabilities),
    disabledReason: languageUnsupportedReason(provider, language.code, capabilities),
  }));
}

interface LanguageSelectorProps {
  value: string;
  onChange: (value: string) => void;
  options?: LanguageOption[];
  provider?: DesktopLanguageProvider;
  className?: string;
  placeholder?: string;
}

const GROUP_LABEL_KEYS: Record<string, string> = {
  automatic: "desktop.languages.groups.automatic",
  "central-asia": "desktop.languages.groups.centralAsia",
  other: "desktop.languages.groups.other",
};

export default function LanguageSelector({
  value,
  onChange,
  options,
  provider,
  className = "",
  placeholder = "Choose language",
}: LanguageSelectorProps) {
  const { t } = useTranslation();
  const configuredProvider = useSettingsStore((state) => {
    if (state.useLocalWhisper) return "whisper" as const;
    if (state.cloudTranscriptionMode === "openwhispr") return "aisha" as const;
    if (["openai", "groq", "mistral", "tinfoil"].includes(state.cloudTranscriptionProvider)) {
      return "whisper" as const;
    }
    return "unknown" as const;
  });
  const items = useMemo(
    () => options ?? getDesktopLanguageOptions(provider ?? configuredProvider),
    [configuredProvider, options, provider]
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const selected = items.find((item) => item.value === value);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return items;
    return items.filter((item) =>
      [item.label, item.localizedName, item.value]
        .filter(Boolean)
        .some((part) => String(part).toLocaleLowerCase().includes(normalized))
    );
  }, [items, query]);

  const selectableIndexes = useMemo(
    () => filtered.map((item, index) => (!item.disabled ? index : -1)).filter((index) => index >= 0),
    [filtered]
  );

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  }, []);

  const select = useCallback(
    (item: LanguageOption | undefined) => {
      if (!item || item.disabled) return;
      onChange(item.value);
      close();
    },
    [close, onChange]
  );

  useEffect(() => {
    if (!open) return;
    const first = selectableIndexes[0] ?? 0;
    setHighlighted(first);
    requestAnimationFrame(() => searchRef.current?.focus());
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!containerRef.current?.contains(target) && !menuRef.current?.contains(target)) close();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [close, open, selectableIndexes]);

  const move = (direction: 1 | -1) => {
    if (!selectableIndexes.length) return;
    const current = selectableIndexes.indexOf(highlighted);
    const next = (current + direction + selectableIndexes.length) % selectableIndexes.length;
    setHighlighted(selectableIndexes[next]);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open && ["Enter", " ", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      select(filtered[highlighted]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  let lastGroup = "";
  const menu = open ? (
    <div
      ref={menuRef}
      className="fixed z-[10000] w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
      style={(() => {
        const rect = triggerRef.current?.getBoundingClientRect();
        return { top: (rect?.bottom ?? 0) + 6, left: Math.min(rect?.left ?? 16, window.innerWidth - 368) };
      })()}
      onKeyDown={onKeyDown}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlighted(0);
          }}
          role="combobox"
          aria-controls={listboxId}
          aria-expanded="true"
          aria-activedescendant={`${listboxId}-${highlighted}`}
          aria-label={t("desktop.languages.search")}
          placeholder={t("desktop.languages.searchPlaceholder")}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {query && (
          <button
            type="button"
            aria-label={t("desktop.languages.clearSearch")}
            onClick={() => setQuery("")}
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
      </div>
      <div id={listboxId} role="listbox" className="max-h-72 overflow-y-auto p-1.5">
        {filtered.map((item, index) => {
          const group = item.group ?? "other";
          const showGroup = group !== lastGroup;
          lastGroup = group;
          return (
            <React.Fragment key={item.value}>
              {showGroup && (
                <div className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {GROUP_LABEL_KEYS[group] ? t(GROUP_LABEL_KEYS[group]) : group}
                </div>
              )}
              <button
                id={`${listboxId}-${index}`}
                type="button"
                role="option"
                aria-selected={item.value === value}
                aria-disabled={item.disabled || undefined}
                disabled={item.disabled}
                title={
                  item.disabled
                    ? t(
                        item.value === "auto"
                          ? "desktop.languages.autoUnsupported"
                          : "desktop.languages.languageUnsupported"
                      )
                    : undefined
                }
                onMouseEnter={() => !item.disabled && setHighlighted(index)}
                onClick={() => select(item)}
                className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                  item.disabled
                    ? "cursor-not-allowed opacity-45"
                    : highlighted === index
                      ? "bg-accent"
                      : "hover:bg-accent/70"
                }`}
              >
                <span className="text-base" aria-hidden="true">{item.flag}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2 text-sm font-medium">
                    {item.localizedName || item.label}
                    <span className="font-mono text-xs uppercase text-muted-foreground">{item.value}</span>
                  </span>
                  {item.disabled && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {t(
                        item.value === "auto"
                          ? "desktop.languages.autoUnsupported"
                          : "desktop.languages.languageUnsupported"
                      )}
                    </span>
                  )}
                </span>
                {item.value === value && <Check className="h-4 w-4 text-primary" />}
              </button>
            </React.Fragment>
          );
        })}
        {!filtered.length && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {t("desktop.languages.empty")}
          </p>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div ref={containerRef} className={className} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((value) => !value)}
        className="flex h-10 w-full items-center gap-2 rounded-lg border border-border bg-background px-3 text-left text-sm outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden="true">{selected?.flag ?? "🌐"}</span>
        <span className="min-w-0 flex-1 truncate">
          {selected?.localizedName ||
            selected?.label ||
            (placeholder === "Choose language" ? t("desktop.languages.choose") : placeholder)}
        </span>
        {selected && <span className="font-mono text-xs uppercase text-muted-foreground">{selected.value}</span>}
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>
      {menu && createPortal(menu, document.body)}
    </div>
  );
}
