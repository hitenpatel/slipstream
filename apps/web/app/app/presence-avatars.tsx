"use client";

import type { PresenceUser } from "@slipstream/protocol";
import { useEngine, useEngineState } from "./engine-provider";
import styles from "./presence-avatars.module.css";

/**
 * Avatar stack showing every workspace peer currently focused on a given
 * entity. The current user is filtered out (you don't need to see your own
 * avatar over the thing you're already looking at).
 *
 * Avatar is the first 1-2 characters of the email, with a deterministic
 * colour-from-userId so the same person always has the same chip across
 * tabs and reloads.
 */
export function PresenceAvatars({
  focus,
  max = 4,
}: {
  focus: { kind: "project" | "issue"; id: string };
  max?: number;
}): React.JSX.Element | null {
  const { me } = useEngine();
  const presence = useEngineState((s) => s.presence);

  const here = presence.filter(
    (u) =>
      u.userId !== me.userId &&
      u.focus &&
      u.focus.kind === focus.kind &&
      u.focus.id === focus.id,
  );

  if (here.length === 0) return null;

  const shown = here.slice(0, max);
  const overflow = here.length - shown.length;

  return (
    <span
      className={styles.row}
      aria-label={
        here.length === 1
          ? `${here[0]!.email} is viewing`
          : `${here.length} others are viewing`
      }
    >
      {shown.map((u) => (
        <Avatar key={u.userId} user={u} />
      ))}
      {overflow > 0 ? <span className={styles.more}>+{overflow}</span> : null}
    </span>
  );
}

function Avatar({ user }: { user: PresenceUser }): React.JSX.Element {
  const initials = user.email.slice(0, 2).toUpperCase();
  return (
    <span
      className={styles.dot}
      title={user.email}
      style={{ background: colourFor(user.userId) }}
    >
      {initials}
    </span>
  );
}

const PALETTE = [
  "#6ea8ff",
  "#3fbf6c",
  "#bf6e6e",
  "#bfaa6e",
  "#aa6ebf",
  "#6ebfae",
  "#bf8f6e",
  "#6ebf9d",
];

function colourFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}
