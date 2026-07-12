import { z } from "zod";
import { IdSchema, IssuePriority } from "./entities.js";

/**
 * AI triage suggestion for a single issue. Produced server-side (the sync
 * server owns the LLM call), consumed by the web client, which applies any
 * accepted parts through the normal `updateIssue` mutator so optimistic
 * updates, the offline outbox and multi-client sync all behave exactly as if
 * the user had made the change by hand.
 */
export const TriageSuggestionSchema = z.object({
  /** Labels the model thinks should be added (existing workspace labels only). */
  labelIds: z.array(IdSchema),
  /** Suggested priority, or null when the model has no opinion. */
  priority: IssuePriority.nullable(),
  /** Ids of open issues in the same project that look like duplicates. */
  duplicateIssueIds: z.array(IdSchema),
});
export type TriageSuggestion = z.infer<typeof TriageSuggestionSchema>;

/**
 * Server-sent events emitted by POST /api/ai/triage. `delta` chunks stream
 * the model's rationale as it generates; a single `suggestion` event carries
 * the parsed, validated result; `error` replaces `suggestion` on failure.
 */
export const TriageEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("delta"), text: z.string() }),
  z.object({ type: z.literal("suggestion"), suggestion: TriageSuggestionSchema }),
  z.object({ type: z.literal("error"), error: z.string() }),
  z.object({ type: z.literal("done") }),
]);
export type TriageEvent = z.infer<typeof TriageEventSchema>;
