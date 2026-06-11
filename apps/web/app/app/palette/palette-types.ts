"use client";

import type { Issue, IssueStatus, Project } from "@slipstream/protocol";

/**
 * A command palette item. The runtime types are kept thin — search/scoring
 * lives in palette-search.ts so it can be unit-tested without React.
 */
export type PaletteItem =
  | {
      kind: "command";
      id: string;
      label: string;
      hint?: string;
      shortcut?: string;
      action: () => void | Promise<void>;
    }
  | {
      kind: "issue";
      id: string;
      issue: Issue;
      project: Project | undefined;
      label: string; // computed: "PROJ-KEY · Issue title"
      action: () => void | Promise<void>;
    }
  | {
      kind: "project";
      id: string;
      project: Project;
      label: string;
      action: () => void | Promise<void>;
    }
  | {
      kind: "status";
      id: string;
      label: string; // "Set status: Todo"
      status: IssueStatus;
      issueId: string;
      action: () => void | Promise<void>;
    };
