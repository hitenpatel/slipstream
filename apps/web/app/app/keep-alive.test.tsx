import { describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { KeepAlive } from "./keep-alive";

/**
 * Two-view harness mirroring the project layout. Both frames are mounted
 * at all times; the test flips `active` to verify the contract.
 */
function Harness({ initial = "list" as "list" | "board" }): React.JSX.Element {
  const [view, setView] = useState<"list" | "board">(initial);
  return (
    <div>
      <button type="button" onClick={() => setView(view === "list" ? "board" : "list")}>
        toggle
      </button>
      <KeepAlive active={view === "list"} label="List view">
        <button type="button">list-action</button>
      </KeepAlive>
      <KeepAlive active={view === "board"} label="Board view">
        <button type="button">board-action</button>
      </KeepAlive>
    </div>
  );
}

describe("KeepAlive", () => {
  it("keeps both children mounted on either side of a toggle", () => {
    render(<Harness initial="list" />);
    // Both buttons exist in the DOM, regardless of which view is active.
    expect(screen.getByText("list-action")).toBeInTheDocument();
    expect(screen.getByText("board-action")).toBeInTheDocument();
    cleanup();
  });

  it("marks the inactive frame as inert + aria-hidden", () => {
    const { container } = render(<Harness initial="list" />);
    const frames = container.querySelectorAll('[data-active]');
    expect(frames).toHaveLength(2);
    const [listFrame, boardFrame] = frames;
    expect(listFrame!.getAttribute("data-active")).toBe("true");
    expect(boardFrame!.getAttribute("data-active")).toBe("false");
    expect(listFrame!.hasAttribute("inert")).toBe(false);
    expect(boardFrame!.hasAttribute("inert")).toBe(true);
    expect(listFrame!.getAttribute("aria-hidden")).toBe("false");
    expect(boardFrame!.getAttribute("aria-hidden")).toBe("true");
    cleanup();
  });

  it("preserves the labels through toggles", () => {
    const { container } = render(<Harness initial="board" />);
    const labels = Array.from(container.querySelectorAll('[data-active]')).map(
      (f) => f.getAttribute("aria-label"),
    );
    expect(labels).toEqual(["List view", "Board view"]);
    cleanup();
  });
});
