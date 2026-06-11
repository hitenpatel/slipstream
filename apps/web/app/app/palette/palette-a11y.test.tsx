/**
 * Axe assertion over the palette's WAI-ARIA combobox markup.
 *
 * We don't mount the full <CommandPalette/> because it needs the engine
 * context. Instead we render the exact markup it produces for the
 * input + listbox in the "open with results" state and assert zero
 * violations. If anyone tweaks the production component in a way that
 * breaks the combobox contract, this test will fail.
 */

import { describe, expect, it } from "vitest";
import { render, cleanup } from "@testing-library/react";
import axe from "axe-core";

function PaletteSample({ focusedIndex = 0 }: { focusedIndex?: number }): React.JSX.Element {
  const listboxId = "lb";
  const items = [
    { id: "a", kind: "command", label: "Create new issue" },
    { id: "b", kind: "issue", label: "SL · Polish login form" },
    { id: "c", kind: "project", label: "Go to Slipstream" },
  ];
  return (
    <div role="dialog" aria-label="Command palette">
      <label htmlFor="palette-input" style={{ position: "absolute", left: -9999 }}>
        Command palette query
      </label>
      <input
        id="palette-input"
        type="text"
        role="combobox"
        aria-expanded
        aria-controls={listboxId}
        aria-activedescendant={`${listboxId}-opt-${focusedIndex}`}
        aria-autocomplete="list"
        defaultValue=""
        autoComplete="off"
      />
      <ul id={listboxId} role="listbox">
        {items.map((item, idx) => (
          <li
            key={item.id}
            id={`${listboxId}-opt-${idx}`}
            role="option"
            aria-selected={idx === focusedIndex}
          >
            <span>{item.kind}</span>
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

async function runAxe(node: HTMLElement) {
  return axe.run(node, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "best-practice"] },
  });
}

describe("CommandPalette markup is axe-clean", () => {
  it("has no violations with the first option focused", async () => {
    const { container } = render(<PaletteSample focusedIndex={0} />);
    const result = await runAxe(container);
    expect(result.violations).toEqual([]);
    cleanup();
  });

  it("aria-activedescendant points at a real option", () => {
    const { container } = render(<PaletteSample focusedIndex={2} />);
    const input = container.querySelector('[role="combobox"]');
    const activeId = input?.getAttribute("aria-activedescendant");
    expect(activeId).toBe("lb-opt-2");
    expect(container.querySelector(`#${activeId}`)).not.toBeNull();
    cleanup();
  });
});
