"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { IssueStatus } from "@slipstream/protocol";
import { useProjectData } from "./hooks";
import { STATUS_LABEL, useFilters } from "./filters";
import styles from "./project-toolbar.module.css";

export function ProjectToolbar({ projectId }: { projectId: string }): React.JSX.Element {
  const { project, issues, labels } = useProjectData(projectId);
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const filters = useFilters();

  const listHref = `/app/${projectId}`;
  const boardHref = `/app/${projectId}/board`;
  const onBoard = pathname.endsWith("/board");

  // Local search input mirrors ?q; we debounce writes to the URL so typing
  // doesn't spam history entries (router.replace is shallow but still pushy).
  const [search, setSearch] = useState(filters.q);
  useEffect(() => {
    setSearch(filters.q);
  }, [filters.q]);
  useEffect(() => {
    const handle = setTimeout(() => {
      if (search === filters.q) return;
      const next = new URLSearchParams(params.toString());
      if (search) next.set("q", search);
      else next.delete("q");
      router.replace(`${pathname}?${next.toString()}`);
    }, 200);
    return () => clearTimeout(handle);
    // we only want this on local search changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function toggleStatus(s: IssueStatus): void {
    const next = new URLSearchParams(params.toString());
    const set = new Set(filters.statuses);
    if (set.has(s)) set.delete(s);
    else set.add(s);
    if (set.size === 0) next.delete("status");
    else next.set("status", Array.from(set).join(","));
    router.replace(`${pathname}?${next.toString()}`);
  }

  function toggleLabel(id: string): void {
    const next = new URLSearchParams(params.toString());
    const set = new Set(filters.labelIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    if (set.size === 0) next.delete("label");
    else next.set("label", Array.from(set).join(","));
    router.replace(`${pathname}?${next.toString()}`);
  }

  function clearAll(): void {
    router.replace(pathname);
    setSearch("");
  }

  const filterActive =
    filters.statuses.length > 0 ||
    filters.labelIds.length > 0 ||
    filters.assignee !== null ||
    filters.q.length > 0;

  const statusOptions = useMemo(() => Object.keys(STATUS_LABEL) as IssueStatus[], []);

  if (!project) return <div className={styles.bar} aria-hidden />;

  return (
    <header className={styles.bar}>
      <div className={styles.headRow}>
        <div className={styles.titles}>
          <p className={styles.eyebrow}>
            <span className={styles.projectKey}>{project.key}</span>
            <span>
              {issues.length} {issues.length === 1 ? "issue" : "issues"}
            </span>
          </p>
          <h1 className={styles.title}>{project.name}</h1>
        </div>

        <nav className={styles.viewSwitch} aria-label="View">
          <Link
            href={`${listHref}${searchSuffix(params)}`}
            data-active={!onBoard}
            className={styles.viewTab}
          >
            List
          </Link>
          <Link
            href={`${boardHref}${searchSuffix(params)}`}
            data-active={onBoard}
            className={styles.viewTab}
          >
            Board
          </Link>
        </nav>
      </div>

      <div className={styles.filterRow}>
        <label className={styles.search}>
          <span className={styles.srOnly}>Search issues by title</span>
          <input
            type="search"
            placeholder="Search issues…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>

        <fieldset className={styles.chipGroup}>
          <legend className={styles.srOnly}>Filter by status</legend>
          {statusOptions.map((s) => (
            <button
              key={s}
              type="button"
              className={styles.chip}
              data-on={filters.statuses.includes(s) ? "true" : "false"}
              onClick={() => toggleStatus(s)}
              aria-pressed={filters.statuses.includes(s)}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </fieldset>

        {labels.length > 0 ? (
          <fieldset className={styles.chipGroup}>
            <legend className={styles.srOnly}>Filter by label</legend>
            {labels.map((l) => (
              <button
                key={l.id}
                type="button"
                className={styles.labelChip}
                data-on={filters.labelIds.includes(l.id) ? "true" : "false"}
                onClick={() => toggleLabel(l.id)}
                aria-pressed={filters.labelIds.includes(l.id)}
                style={{ ["--label-colour" as string]: l.colour }}
              >
                <span className={styles.swatch} aria-hidden />
                {l.name}
              </button>
            ))}
          </fieldset>
        ) : null}

        {filterActive ? (
          <button type="button" className={styles.clear} onClick={clearAll}>
            Clear filters
          </button>
        ) : null}
      </div>
    </header>
  );
}

function searchSuffix(params: URLSearchParams): string {
  // Preserve ?issue, ?status, ?label, ?q across the list↔board hop so a saved
  // URL keeps working when the user switches views.
  const out = new URLSearchParams();
  for (const [k, v] of params) out.set(k, v);
  const s = out.toString();
  return s ? `?${s}` : "";
}
