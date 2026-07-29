import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  BookOpen,
  Check,
  Cloud,
  CloudOff,
  CornerDownLeft,
  Download,
  LoaderCircle,
  Pencil,
  Plus,
  Sparkles,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Button } from "./ui/button";
import { ConfirmDialog } from "./ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { useToast } from "./ui/useToast";
import SnippetsView from "./SnippetsView";
import { useSettings } from "../hooks/useSettings";
import { getAgentName } from "../utils/agentName";
import type { DesktopDictionaryEntry } from "../types/electron";

const LANGUAGES = [
  ["und", "Barcha tillar"],
  ["uz-Latn", "O‘zbekcha"],
  ["uz-Cyrl", "Ўзбекча"],
  ["kk-Cyrl", "Қазақша"],
  ["kk-Latn", "Qazaqşa"],
  ["ky-Cyrl", "Кыргызча"],
  ["tg-Cyrl", "Тоҷикӣ"],
  ["tk-Latn", "Türkmençe"],
  ["ru-Cyrl", "Русский"],
  ["en-Latn", "English"],
] as const;

const parseWords = (text: string): string[] =>
  text
    .split(/[,\n]/)
    .map((word) => word.trim())
    .filter(Boolean);

const normalizeWord = (word: string) => word.normalize("NFKC").trim().toLocaleLowerCase();

function statusLabel(entry: DesktopDictionaryEntry, t: TFunction) {
  if (entry.syncStatus === "synced") {
    return { text: t("desktop.dictionary.status.synced"), icon: Cloud };
  }
  if (entry.syncStatus === "conflict") {
    return {
      text: t("desktop.dictionary.status.conflict"),
      icon: TriangleAlert,
    };
  }
  if (entry.syncStatus === "error") {
    return {
      text: t("desktop.dictionary.status.syncError"),
      icon: CloudOff,
    };
  }
  if (entry.syncStatus === "syncing") {
    return {
      text: t("desktop.dictionary.status.syncing"),
      icon: LoaderCircle,
    };
  }
  return {
    text: t("desktop.dictionary.status.savedLocal"),
    icon: Check,
  };
}

export default function DictionaryView() {
  const { t } = useTranslation();
  const {
    customDictionary,
    dictionaryEntries,
    dictionaryState,
    dictionarySaving,
    createDictionaryWords,
    updateDictionaryWord,
    deleteDictionaryWord,
    clearDictionaryWords,
    decideLegacyDictionary,
  } = useSettings();
  const agentName = getAgentName();
  const { toast } = useToast();
  const [newWord, setNewWord] = useState("");
  const [language, setLanguage] = useState("und");
  const [bulkText, setBulkText] = useState("");
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [pendingEntryIds, setPendingEntryIds] = useState<Set<string>>(() => new Set());
  const addInputRef = useRef<HTMLInputElement>(null);

  const pendingImportCount = useMemo(() => parseWords(bulkText).length, [bulkText]);
  const searchQuery = newWord.trim().toLocaleLowerCase();
  const visibleEntries = useMemo(
    () =>
      searchQuery
        ? dictionaryEntries.filter((entry) =>
            entry.displayForm.toLocaleLowerCase().includes(searchQuery)
          )
        : dictionaryEntries,
    [dictionaryEntries, searchQuery]
  );

  const reportFailure = useCallback(
    (error: unknown) => {
      toast({
        title: t("desktop.dictionary.actionFailed"),
        description:
          error instanceof Error
            ? error.message
            : t("desktop.dictionary.tryAgain"),
        variant: "destructive",
      });
    },
    [t, toast]
  );

  const addWords = useCallback(
    async (text: string) => {
      if (dictionarySaving) return;
      const existing = new Set(dictionaryEntries.map((entry) => normalizeWord(entry.displayForm)));
      const parsed = Array.from(
        new Map(parseWords(text).map((word) => [normalizeWord(word), word])).values()
      );
      const fresh = parsed.filter((word) => !existing.has(normalizeWord(word)));
      const duplicateCount = parsed.length - fresh.length;
      if (!fresh.length) {
        toast({
          title: t("desktop.dictionary.duplicateTitle"),
          description: t("desktop.dictionary.duplicateDescription"),
        });
        return;
      }
      try {
        const count = await createDictionaryWords(fresh, language);
        if (count > 0) {
          setNewWord("");
          setBulkText("");
          setShowBulkImport(false);
          if (duplicateCount > 0) {
            toast({
              title: t("desktop.dictionary.saved"),
              description: t("desktop.dictionary.duplicatesSkipped", {
                count: duplicateCount,
              }),
            });
          }
        }
      } catch (error) {
        reportFailure(error);
      }
    },
    [createDictionaryWords, dictionaryEntries, dictionarySaving, language, reportFailure, t, toast]
  );

  const commitEdit = useCallback(async () => {
    if (!editingId) return;
    const displayForm = editValue.trim();
    if (!displayForm) return;
    const duplicate = dictionaryEntries.some(
      (entry) =>
        entry.id !== editingId && normalizeWord(entry.displayForm) === normalizeWord(displayForm)
    );
    if (duplicate) {
      toast({
        title: t("desktop.dictionary.duplicateTitle"),
        description: t("desktop.dictionary.duplicateDescription"),
      });
      return;
    }
    setPendingEntryIds((current) => new Set(current).add(editingId));
    try {
      await updateDictionaryWord(editingId, displayForm);
      setEditingId(null);
    } catch (error) {
      reportFailure(error);
    } finally {
      setPendingEntryIds((current) => {
        const next = new Set(current);
        next.delete(editingId);
        return next;
      });
    }
  }, [dictionaryEntries, editValue, editingId, reportFailure, t, toast, updateDictionaryWord]);

  const removeWord = useCallback(
    async (id: string) => {
      if (dictionarySaving || pendingEntryIds.has(id)) return;
      setPendingEntryIds((current) => new Set(current).add(id));
      try {
        await deleteDictionaryWord(id);
      } catch (error) {
        reportFailure(error);
      } finally {
        setPendingEntryIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    },
    [deleteDictionaryWord, dictionarySaving, pendingEntryIds, reportFailure]
  );

  const handleExport = useCallback(async () => {
    const result = await window.electronAPI?.exportDictionary?.(
      customDictionary.filter((word) => word !== agentName)
    );
    if (result?.error) {
      toast({
        title: t("dictionary.exportFailed"),
        description: result.error,
        variant: "destructive",
      });
    }
  }, [agentName, customDictionary, toast, t]);

  const emptyState = (
    <div className="flex flex-col items-center text-center py-9">
      <div className="w-10 h-10 rounded-[10px] bg-primary/6 flex items-center justify-center mb-3.5">
        <BookOpen size={17} strokeWidth={1.5} className="text-primary/55" />
      </div>
      <h4 className="text-sm font-semibold text-foreground mb-1">
        {t("dictionary.emptyTitle")}
      </h4>
      <p className="text-xs text-foreground/45 leading-relaxed max-w-[260px] mb-4">
        {t("dictionary.emptyDescription", { agentName })}
      </p>
      <Button size="sm" onClick={() => addInputRef.current?.focus()}>
        <Plus size={13} />
        {t("dictionary.addFirstWord")}
      </Button>
    </div>
  );

  return (
    <Tabs defaultValue="dictionary" className="flex flex-col h-full">
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={t("dictionary.clearTitle")}
        description={t("dictionary.clearDescription")}
        onConfirm={() => {
          if (!dictionarySaving) void clearDictionaryWords().catch(reportFailure);
        }}
        variant="destructive"
      />

      <div className="px-5 pt-4">
        <TabsList className="h-8 p-0.5 rounded-[7px]">
          <TabsTrigger value="dictionary" className="h-7 px-3 text-xs rounded-[5px]">
            {t("dictionary.tabDictionary")}
          </TabsTrigger>
          <TabsTrigger value="snippets" className="h-7 px-3 text-xs rounded-[5px]">
            {t("dictionary.tabSnippets")}
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="dictionary" className="flex-1 min-h-0 mt-0 overflow-y-auto">
        <div className="px-5 py-4 flex flex-col gap-3.5">
          {dictionaryState?.requiresLegacyDecision && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3.5">
              <div className="flex gap-2.5">
                <Cloud size={15} className="text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t("dictionary.legacyTitle", { defaultValue: "Oldingi so‘zlaringiz topildi" })}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-foreground/50">
                    {t("dictionary.legacyDescription", {
                      defaultValue:
                        "Ularni shu VoiceLab hisobiga biriktiring yoki faqat ushbu qurilmada qoldiring.",
                    })}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={dictionarySaving}
                      onClick={() => void decideLegacyDictionary("attach").catch(reportFailure)}
                    >
                      {t("dictionary.attachToAccount", { defaultValue: "Hisobga biriktirish" })}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={dictionarySaving}
                      onClick={() =>
                        void decideLegacyDictionary("keep_local").catch(reportFailure)
                      }
                    >
                      {t("dictionary.keepOnDevice", { defaultValue: "Qurilmada qoldirish" })}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                ref={addInputRef}
                placeholder={t("dictionary.addPlaceholder")}
                value={newWord}
                onChange={(event) => setNewWord(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void addWords(newWord);
                }}
                className="w-full h-9 text-sm pr-20"
              />
              <button
                onClick={() => void addWords(newWord)}
                disabled={!newWord.trim() || dictionarySaving}
                aria-label={t("dictionary.addWord")}
                className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-xs text-foreground/45 enabled:hover:text-primary disabled:opacity-40"
              >
                {dictionarySaving ? <LoaderCircle size={12} className="animate-spin" /> : null}
                {t("dictionary.add")}
                <CornerDownLeft size={11} />
              </button>
            </div>
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              aria-label={t("dictionary.language", { defaultValue: "Til" })}
              className="h-9 max-w-[150px] rounded-md border border-input bg-background px-2.5 text-xs text-foreground"
            >
              {LANGUAGES.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => setShowBulkImport((value) => !value)}
            >
              <Upload size={13} />
              {t("dictionary.import")}
            </Button>
          </div>

          {showBulkImport && (
            <div className="rounded-lg border border-primary/20 p-3">
              <Textarea
                autoFocus
                value={bulkText}
                onChange={(event) => setBulkText(event.target.value)}
                placeholder={t("dictionary.importPlaceholder")}
                rows={4}
                className="min-h-[82px] resize-none text-sm"
              />
              <div className="flex items-center justify-between gap-3 pt-2.5">
                <p className="text-xs text-foreground/45">
                  {t("dictionary.wordsReady", { count: pendingImportCount })}
                </p>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowBulkImport(false)}>
                    {t("common.cancel")}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!pendingImportCount || dictionarySaving}
                    onClick={() => void addWords(bulkText)}
                  >
                    {t("dictionary.import")}
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-lg bg-primary/5 px-3.5 py-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles size={12} className="text-primary shrink-0" />
              <span className="text-xs font-medium text-primary truncate">{agentName}</span>
            </div>
            <span className="text-xs text-foreground/40">{t("dictionary.agentDefault")}</span>
          </div>

          <div className="rounded-lg border border-foreground/10 bg-background px-3.5 py-3">
            {dictionaryEntries.length > 0 && (
              <div className="flex items-center justify-between pb-2.5">
                <h3 className="text-xs font-semibold text-foreground/55">
                  {t("dictionary.yourDictionary")}
                </h3>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setConfirmClear(true)}
                    disabled={dictionarySaving}
                    className="text-xs text-foreground/35 enabled:hover:text-destructive disabled:opacity-40"
                  >
                    {t("dictionary.clearAll")}
                  </button>
                  <button
                    onClick={() => void handleExport()}
                    aria-label={t("dictionary.exportDictionary")}
                    className="text-foreground/40 hover:text-foreground"
                  >
                    <Download size={13} />
                  </button>
                </div>
              </div>
            )}

            {dictionaryEntries.length === 0 ? (
              emptyState
            ) : visibleEntries.length === 0 ? (
              <p className="py-7 text-xs text-foreground/40 text-center">
                {t("dictionary.noMatches", { word: newWord.trim() })}
              </p>
            ) : (
              <ul>
                {visibleEntries.map((entry) => {
                  const isEditing = editingId === entry.id;
                  const isPending = pendingEntryIds.has(entry.id);
                  const status = statusLabel(entry, t);
                  const StatusIcon = status.icon;
                  return (
                    <li
                      key={entry.id}
                      className="group flex items-center gap-3 min-h-11 border-t border-foreground/7 first:border-t-0"
                    >
                      {isEditing ? (
                        <Input
                          autoFocus
                          value={editValue}
                          onChange={(event) => setEditValue(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void commitEdit();
                            if (event.key === "Escape") setEditingId(null);
                          }}
                          className="h-8 text-sm flex-1"
                          disabled={isPending}
                        />
                      ) : (
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-foreground/80">{entry.displayForm}</p>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-foreground/40">
                            <StatusIcon
                              size={10}
                              className={entry.syncStatus === "syncing" ? "animate-spin" : ""}
                            />
                            <span>{status.text}</span>
                          </div>
                        </div>
                      )}
                      {!isEditing && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                          <button
                            disabled={dictionarySaving || isPending}
                            onClick={() => {
                              setEditingId(entry.id);
                              setEditValue(entry.displayForm);
                            }}
                            aria-label={t("dictionary.editWord", { word: entry.displayForm })}
                            className="p-1.5 text-foreground/35 enabled:hover:text-foreground disabled:opacity-40"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            disabled={dictionarySaving || isPending}
                            onClick={() => void removeWord(entry.id)}
                            aria-label={t("dictionary.removeWord", {
                              word: entry.displayForm,
                            })}
                            className="p-1.5 text-foreground/35 enabled:hover:text-destructive disabled:opacity-40"
                          >
                            {isPending ? (
                              <LoaderCircle size={12} className="animate-spin" />
                            ) : (
                              <X size={12} />
                            )}
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </TabsContent>

      <TabsContent value="snippets" className="flex-1 min-h-0 mt-0 overflow-y-auto">
        <SnippetsView />
      </TabsContent>
    </Tabs>
  );
}
