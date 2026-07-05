import * as Y from "yjs";

/**
 * Per-field CRDT support for fields that need it.
 *
 * For M7c the only such field is `Issue.description`. The field is stored on
 * the entity as a base64-encoded Y.Doc state vector + history; the Y.Text
 * inside the doc lives at the key "body". The encoded blob lives in the
 * existing string field, so the entity Zod schema doesn't need to change
 * shape — only its semantics.
 *
 * Round-trip guarantees:
 *   - `encodeDoc(decodeDoc(s))` is byte-equivalent.
 *   - `applyUpdate(decodeDoc(s), updateB64)` then re-encoded yields the same
 *     bytes regardless of the order updates are applied in (Yjs CRDT
 *     commutativity).
 *
 * Backward-compat note: existing issues created before M7c have plain text
 * descriptions, not Y.Doc states. `decodeDocOrFromText` covers both by
 * trying the binary decode first and falling back to a fresh doc seeded
 * with the plain text.
 */

export const Y_TEXT_FIELD = "body" as const;

const B64 = {
  encode: (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64"),
  decode: (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, "base64")),
};

/** Brand-new doc with an empty body. */
export function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getText(Y_TEXT_FIELD); // ensure the field exists
  return doc;
}

/** Encode the current state of a doc to a base64 string. */
export function encodeDoc(doc: Y.Doc): string {
  const update = Y.encodeStateAsUpdate(doc);
  return B64.encode(update);
}

/** Decode a base64-encoded doc back into a Y.Doc. */
export function decodeDoc(b64: string): Y.Doc {
  const doc = makeDoc();
  if (!b64) return doc;
  try {
    Y.applyUpdate(doc, B64.decode(b64));
  } catch {
    // not a valid Y.Doc state — return the empty doc rather than throwing.
    // The caller can decide whether to seed it with legacy text via
    // decodeDocOrFromText.
  }
  return doc;
}

/**
 * Backwards-compat decoder: try to read as a Y.Doc binary state first;
 * if that fails, treat the value as plain text and seed a fresh doc.
 *
 * Used by the mutator to handle pre-M7c issues without a migration step.
 */
export function decodeDocOrFromText(value: string): Y.Doc {
  const doc = decodeDoc(value);
  if (doc.getText(Y_TEXT_FIELD).length === 0 && value && !looksLikeBase64State(value)) {
    doc.getText(Y_TEXT_FIELD).insert(0, value);
  }
  return doc;
}

/**
 * Apply a base64-encoded Yjs update to a doc. Returns the doc for chaining.
 * Idempotent on duplicate updates (Yjs dedupes by op id).
 *
 * Defensive against pre-M7c or seed data: if the value doesn't look like a
 * base64 Y.Doc state (typical prose, plain text) the call is a no-op. The
 * legacy-text seeding path lives in `decodeDocOrFromText`; this helper's job
 * is just to fold in a real update without ever throwing at a caller.
 */
export function applyUpdateB64(doc: Y.Doc, b64: string): Y.Doc {
  if (!b64) return doc;
  if (!looksLikeBase64State(b64)) return doc;
  try {
    Y.applyUpdate(doc, B64.decode(b64));
  } catch {
    // corrupt update or transient decode failure — leave the doc as-is
  }
  return doc;
}

/**
 * Convenience for the UI: get the current text from the doc's body field.
 */
export function readBody(doc: Y.Doc): string {
  return doc.getText(Y_TEXT_FIELD).toString();
}

/**
 * Produce a base64-encoded update that captures the difference between
 * the doc's current state and a previously-captured state vector.
 *
 * The client uses this on each input event: snapshot the state vector
 * before applying the input, mutate the Y.Text, then call this with the
 * pre-input vector to generate the delta to send through the engine.
 */
export function diffUpdateB64(doc: Y.Doc, sinceStateVector: Uint8Array): string {
  const update = Y.encodeStateAsUpdate(doc, sinceStateVector);
  return B64.encode(update);
}

/**
 * Snapshot the current state vector so a later diffUpdateB64 can compute
 * the delta from this moment.
 */
export function snapshotStateVector(doc: Y.Doc): Uint8Array {
  return Y.encodeStateVector(doc);
}

const BASE64_RE = /^[A-Za-z0-9+/=]+$/;

function looksLikeBase64State(value: string): boolean {
  // Cheap heuristic — Y.Doc states are binary blobs serialised as base64.
  // Plain prose almost always contains a space or punctuation that fails
  // the base64 character set.
  if (value.length < 8) return false;
  return BASE64_RE.test(value);
}
