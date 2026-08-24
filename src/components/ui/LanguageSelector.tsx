import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, X } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import searchIcon from "../../assets/icons/search.svg";
import type { DesktopLanguageProvider } from "../../config/desktopLanguages";
import {
  getDesktopLanguageOptions,
  type LanguageOption,
} from "../../config/desktopLanguageOptions";
import VoiceLabIcon from "./VoiceLabIcon";

interface LanguageSelectorProps {
  value: string;
  onChange: (value: string) => void;
  options?: LanguageOption[];
  provider?: DesktopLanguageProvider;
  className?: string;
  placeholder?: string;
}

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
    if (state.cloudTranscriptionMode === "openwhispr") return "voicelab" as const;
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
    () =>
      filtered.map((item, index) => (!item.disabled ? index : -1)).filter((index) => index >= 0),
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
    const selectedIndex = selectableIndexes.find((index) => filtered[index]?.value === value);
    setHighlighted(selectedIndex ?? selectableIndexes[0] ?? 0);
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [filtered, open, selectableIndexes, value]);

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

  const menu = (
    <Popover.Portal>
      <Popover.Content
        className="z-[100] w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border/80 bg-popover shadow-[0_4px_14px_rgba(0,0,0,0.14)] dark:shadow-[0_4px_16px_rgba(0,0,0,0.35)]"
        side="bottom"
        align="end"
        sideOffset={6}
        collisionPadding={16}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          requestAnimationFrame(() => searchRef.current?.focus());
        }}
        onKeyDown={onKeyDown}
      >
      <div className="p-2">
        <div className="flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2.5">
          <VoiceLabIcon source={searchIcon} className="h-4 w-4 text-muted-foreground" />
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
            className="input-inline min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button
              type="button"
              aria-label={t("desktop.languages.clearSearch")}
              onClick={() => setQuery("")}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div id={listboxId} role="listbox" className="max-h-64 overflow-y-auto px-1.5 pb-1.5">
        {filtered.map((item, index) => {
          return (
            <button
              key={item.value}
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
              className={`flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors ${
                item.disabled
                  ? "cursor-not-allowed opacity-45"
                  : highlighted === index
                    ? "bg-accent"
                    : "hover:bg-accent/70"
              }`}
            >
              <span className="text-sm" aria-hidden="true">
                {item.flag}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {item.localizedName || item.label}
              </span>
              <span className="text-[11px] font-medium uppercase text-muted-foreground">
                {item.value}
              </span>
              {item.value === value && <Check className="h-4 w-4 shrink-0 text-foreground" />}
            </button>
          );
        })}
        {!filtered.length && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {t("desktop.languages.empty")}
          </p>
        )}
      </div>
      </Popover.Content>
    </Popover.Portal>
  );

  return (
    <Popover.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
    >
      <div className={className} onKeyDown={onKeyDown}>
        <Popover.Trigger asChild>
          <button
            ref={triggerRef}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={listboxId}
            className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-md border border-border/80 bg-background/70 px-3 text-left text-sm outline-none transition-colors hover:border-border-hover hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            <span aria-hidden="true">{selected?.flag ?? "🌐"}</span>
            <span className="min-w-0 flex-1 truncate">
              {selected?.localizedName ||
                selected?.label ||
                (placeholder === "Choose language" ? t("desktop.languages.choose") : placeholder)}
            </span>
            {selected && (
              <span className="font-mono text-xs uppercase text-muted-foreground">
                {selected.value}
              </span>
            )}
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </button>
        </Popover.Trigger>
        {menu}
      </div>
    </Popover.Root>
  );
}
