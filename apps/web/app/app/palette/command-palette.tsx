"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  IssueStatus as IssueStatusZ,
  type IssueStatus as IssueStatusT,
  type Issue,
  type Project,
} from "@slipstream/protocol";
import { useEngine, useEngineState } from "../engine-provider";
import { STATUS_LABEL } from "../[projectId]/filters";
import { scoreItems } from "./palette-search";
import type { PaletteItem } from "./palette-types";
import styles from "./command-palette.module.css";

const STATUSES: IssueStatusT[] = ["backlog", "todo", "in_progress", "done", "cancelled"];

/**
 * Global command palette. Mounted once in the app shell. Opens on Cmd/Ctrl-K
 * (and ignores the shortcut when the user is typing in a text input that is
 * NOT the palette's own input). Closes on Escape.
 *
 * The combobox follows the WAI-ARIA Authoring Practices:
 *   - input has role="combobox", aria-expanded, aria-controls (the listbox
 *     id), aria-activedescendant (the focused option id)
 *   - listbox has role="listbox"
 *   - options have role="option" with id=`${listboxId}-${index}` and
 *     aria-selected on the focused row
 * Focus stays on the input throughout; arrow keys move the focused option
 * via aria-activedescendant, never via DOM focus.
 */
export function CommandPalette({
  contextProjectId,
}: {
  contextProjectId?: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastFocusRef = useRef<HTMLElement | null>(null);

  const { engine, me } = useEngine();
  const view = useEngineState((s) => s.view);
  const router = useRouter();

  const listboxId = useId();

  // ---- gather palette items from the view ----
  const items = useMemo<PaletteItem[]>(() => {
    const projects: Project[] = [];
    const issues: Issue[] = [];
    for (const e of view.entities.values()) {
      if (e.deleted) continue;
      if (e.kind === "project" && e.workspaceId === me.workspaceId) projects.push(e);
      else if (e.kind === "issue" && e.workspaceId === me.workspaceId) issues.push(e);
    }
    const projectById = new Map(projects.map((p) => [p.id, p] as const));

    const close = () => setOpen(false);

    const commands: PaletteItem[] = [];

    // Always-on commands
    if (contextProjectId) {
      commands.push({
        kind: "command",
        id: "cmd:new-issue",
        label: "Create new issue in this project",
        hint: "Enter to create empty, then edit",
        action: async () => {
          const { uuidv7, between } = await import("@slipstream/protocol");
          const lastIssue = issues
            .filter((i) => i.projectId === contextProjectId)
            .sort((a, b) => a.position.localeCompare(b.position))
            .pop();
          const id = uuidv7();
          await engine.mutate("createIssue", {
            id,
            workspaceId: me.workspaceId,
            projectId: contextProjectId,
            title: "Untitled",
            position: between(lastIssue?.position ?? null, null),
          });
          void engine.sync();
          close();
          router.replace(`/app/${contextProjectId}?issue=${id}`);
        },
      });
    }
    commands.push({
      kind: "command",
      id: "cmd:sign-out",
      label: "Sign out",
      action: async () => {
        await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
        window.location.href = "/login";
      },
    });

    // Per-issue status commands appear when the query mentions a status word
    const statusItems: PaletteItem[] = [];

    // Project navigation
    const projectItems: PaletteItem[] = projects.map((p) => ({
      kind: "project" as const,
      id: `proj:${p.id}`,
      project: p,
      label: `Go to ${p.name}`,
      action: () => {
        close();
        router.replace(`/app/${p.id}`);
      },
    }));

    // Issue navigation
    const issueItems: PaletteItem[] = issues.map((issue) => {
      const project = projectById.get(issue.projectId);
      const prefix = project ? `${project.key} · ` : "";
      return {
        kind: "issue" as const,
        id: `issue:${issue.id}`,
        issue,
        project,
        label: `${prefix}${issue.title}`,
        action: () => {
          close();
          router.replace(`/app/${issue.projectId}?issue=${issue.id}`);
        },
      };
    });

    return [...commands, ...statusItems, ...projectItems, ...issueItems];
  }, [view, me.workspaceId, contextProjectId, engine, router]);

  // Status commands derived from the current query: if it contains a status
  // keyword AND there's a contextual issue (via the open detail dialog or the
  // contextProjectId's first match), surface a "Set status: ..." command.
  const filtered = useMemo(() => {
    let withStatusCmds = items;
    const q = query.toLowerCase();
    const statusHit = STATUSES.find((s) => q.includes(s) || q.includes(STATUS_LABEL[s].toLowerCase()));
    if (statusHit && contextProjectId) {
      // Add one status command per visible issue in the current project so the
      // user can "set status: in progress · Add login" in two key presses.
      const issuesInProject: PaletteItem[] = items
        .filter((it): it is Extract<PaletteItem, { kind: "issue" }> =>
          it.kind === "issue" && it.issue.projectId === contextProjectId,
        )
        .map((it) => ({
          kind: "status",
          id: `status:${statusHit}:${it.issue.id}`,
          label: `Set status ${STATUS_LABEL[statusHit]} on ${it.issue.title}`,
          status: statusHit,
          issueId: it.issue.id,
          action: async () => {
            const parsed = IssueStatusZ.safeParse(statusHit);
            if (parsed.success) {
              await engine.mutate("updateIssueStatus", { id: it.issue.id, status: parsed.data });
              void engine.sync();
            }
            setOpen(false);
          },
        }));
      withStatusCmds = [...issuesInProject, ...items];
    }
    return scoreItems(withStatusCmds, query);
  }, [items, query, contextProjectId, engine]);

  // ---- global open shortcut: Cmd/Ctrl-K ----
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        // If we're typing in another input, only intercept when not in a
        // textarea (so palette doesn't steal Cmd-K inside descriptions).
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName.toLowerCase();
        if (tag === "textarea" || target?.isContentEditable) return;
        e.preventDefault();
        lastFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
        setOpen(true);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Restore focus on close
  useEffect(() => {
    if (open) {
      setQuery("");
      setFocusedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (lastFocusRef.current) {
      const el = lastFocusRef.current;
      if (document.body.contains(el)) el.focus();
      lastFocusRef.current = null;
    }
  }, [open]);

  // Keep focusedIndex within bounds when the list shrinks
  useEffect(() => {
    if (focusedIndex >= filtered.length) setFocusedIndex(0);
  }, [filtered.length, focusedIndex]);

  const onInputKey = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((i) =>
          filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length,
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = filtered[focusedIndex];
        if (item) void item.action();
      } else if (e.key === "Home") {
        e.preventDefault();
        setFocusedIndex(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setFocusedIndex(Math.max(0, filtered.length - 1));
      }
    },
    [filtered, focusedIndex],
  );

  if (!open) return <PaletteHint />;

  return (
    <div
      className={styles.scrim}
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div role="dialog" aria-label="Command palette" className={styles.dialog}>
        <input
          ref={inputRef}
          type="text"
          className={styles.input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setFocusedIndex(0);
          }}
          onKeyDown={onInputKey}
          role="combobox"
          aria-expanded
          aria-controls={listboxId}
          aria-activedescendant={
            filtered.length > 0 ? `${listboxId}-opt-${focusedIndex}` : undefined
          }
          aria-autocomplete="list"
          placeholder="Type a command or jump to an issue…"
          autoComplete="off"
          spellCheck={false}
        />
        <ul id={listboxId} role="listbox" className={styles.list}>
          {filtered.length === 0 ? (
            <li className={styles.empty} role="option" aria-selected={false}>
              No matches.
            </li>
          ) : (
            filtered.map((item, idx) => (
              <li
                key={item.id}
                id={`${listboxId}-opt-${idx}`}
                role="option"
                aria-selected={idx === focusedIndex}
                className={styles.option}
                data-focused={idx === focusedIndex ? "true" : "false"}
                onMouseMove={() => setFocusedIndex(idx)}
                onClick={() => void item.action()}
              >
                <span className={styles.kindTag}>
                  {item.kind === "command"
                    ? "Cmd"
                    : item.kind === "issue"
                      ? "Issue"
                      : item.kind === "project"
                        ? "Project"
                        : "Status"}
                </span>
                <span className={styles.itemLabel}>{item.label}</span>
                {item.kind === "command" && item.hint ? (
                  <span className={styles.hint}>{item.hint}</span>
                ) : null}
              </li>
            ))
          )}
        </ul>
        <footer className={styles.footer}>
          <kbd>↑ ↓</kbd> navigate · <kbd>↵</kbd> select · <kbd>Esc</kbd> close
        </footer>
      </div>
    </div>
  );
}

/**
 * A subtle hint at the bottom-right of the viewport so a first-time user
 * discovers the palette without needing onboarding. Hidden when the palette
 * is open (it's redundant) and hidden under prefers-reduced-motion when it
 * would otherwise fade in.
 */
function PaletteHint(): React.JSX.Element {
  // detect platform once so the hint shows the right modifier label
  const [mod, setMod] = useState<"⌘" | "Ctrl">("Ctrl");
  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform)) setMod("⌘");
  }, []);
  return (
    <p className={styles.hint} aria-hidden>
      <kbd>{mod}</kbd> <kbd>K</kbd> for commands
    </p>
  );
}
