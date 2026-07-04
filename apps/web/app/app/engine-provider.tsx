"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useStore } from "zustand";
import {
  Engine,
  HttpTransport,
  WebSocketPokeChannel,
  openClientStorage,
} from "@slipstream/client";
import type { EngineState } from "@slipstream/client";
import type { Me } from "@/lib/session";

interface EngineContext {
  engine: Engine;
  me: Me;
}

const EngineCtx = createContext<EngineContext | null>(null);

export function EngineProvider({
  me,
  children,
}: {
  me: Me;
  children: ReactNode;
}): React.JSX.Element {
  const [engine, setEngine] = useState<Engine | null>(null);
  const bootedRef = useRef(false);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    let mounted = true;
    let local: Engine | null = null;
    let removeListeners: (() => void) | null = null;

    (async () => {
      // each user gets their own IDB database, so signing out / switching
      // accounts doesn't cross the streams.
      const storage = await openClientStorage(`slipstream:${me.userId}`);
      const transport = new HttpTransport("");
      const wsUrl =
        window.location.protocol === "https:"
          ? `wss://${window.location.host}/api/sync`
          : `ws://${window.location.host}/api/sync`;
      const pokeChannel = new WebSocketPokeChannel({ url: wsUrl });

      const eng = await Engine.open({ storage, transport, pokeChannel });
      if (!mounted) {
        eng.close();
        return;
      }
      local = eng;
      // initial sync — pull whatever the server has for this workspace.
      // Failed syncs self-retry with backoff; returning focus or regaining
      // network is a strong "try now" signal, so use those too.
      void eng.sync();
      const resync = () => void eng.sync();
      window.addEventListener("online", resync);
      window.addEventListener("focus", resync);
      removeListeners = () => {
        window.removeEventListener("online", resync);
        window.removeEventListener("focus", resync);
      };
      setEngine(eng);
    })();

    return () => {
      mounted = false;
      removeListeners?.();
      local?.close();
    };
  }, [me.userId]);

  const value = useMemo<EngineContext | null>(
    () => (engine ? { engine, me } : null),
    [engine, me],
  );

  if (!value) {
    return (
      <main aria-live="polite" style={{ minHeight: "100dvh", display: "grid", placeItems: "center" }}>
        <p style={{ color: "var(--color-text-muted)" }}>Loading your workspace…</p>
      </main>
    );
  }
  return <EngineCtx.Provider value={value}>{children}</EngineCtx.Provider>;
}

export function useEngine(): EngineContext {
  const ctx = useContext(EngineCtx);
  if (!ctx) throw new Error("useEngine must be used inside <EngineProvider>");
  return ctx;
}

export function useEngineState<T>(selector: (state: EngineState) => T): T {
  const { engine } = useEngine();
  return useStore(engine.store, selector);
}
