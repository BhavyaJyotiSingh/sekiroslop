import { useEffect, useState, type FormEvent } from "react";
import { getServerHealthUrl } from "../net/useColosseumRoom";
import { shouldShowIosFullscreenTip } from "../input/mobileDisplay";

interface LobbyScreenProps {
  connecting: boolean;
  error: string | null;
  onCreate: (name: string) => void;
  onJoin: (code: string, name: string) => void;
}

type ServerWakeState = "checking" | "online" | "waking";

export function LobbyScreen({ connecting, error, onCreate, onJoin }: LobbyScreenProps) {
  const [name, setName] = useState("Marcus");
  const [code, setCode] = useState("");
  const [serverState, setServerState] = useState<ServerWakeState>("checking");

  // Auto-wake Render Free server on Lobby load so cold starts finish before clicking Create/Join
  useEffect(() => {
    let cancelled = false;
    let retryTimerId: number | undefined;
    let abortTimeoutId: number | undefined;
    let activeController: AbortController | null = null;
    const healthUrl = getServerHealthUrl();

    const ping = async () => {
      const controller = new AbortController();
      activeController = controller;
      abortTimeoutId = window.setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(healthUrl, { signal: controller.signal });
        if (!cancelled && res.ok) {
          setServerState("online");
          return;
        }
      } catch {
        // Free-tier host may still be waking from sleep
      } finally {
        if (abortTimeoutId !== undefined) {
          window.clearTimeout(abortTimeoutId);
          abortTimeoutId = undefined;
        }
        if (activeController === controller) {
          activeController = null;
        }
      }
      if (!cancelled) {
        setServerState("waking");
        retryTimerId = window.setTimeout(() => void ping(), 4000);
      }
    };

    void ping();
    return () => {
      cancelled = true;
      if (retryTimerId !== undefined) window.clearTimeout(retryTimerId);
      if (abortTimeoutId !== undefined) window.clearTimeout(abortTimeoutId);
      activeController?.abort();
    };
  }, []);

  const handleJoinSubmit = (e: FormEvent) => {
    e.preventDefault();
    onJoin(code, name);
  };

  return (
    <div className="lobby-overlay">
      <div className="lobby-hero-art" aria-hidden="true" />
      <div className="lobby-vignette" aria-hidden="true" />

      <main className="lobby-stage">
        <header className="lobby-brand">
          <span className="lobby-kicker">Co-op &amp; 3v3 · Steel &amp; Posture</span>
          <h1 className="lobby-title">
            SEKIRO<span>SLOP</span>
          </h1>
          <div className="lobby-rule" aria-hidden="true" />
        </header>

        <section className="lobby-panel" aria-label="Enter the arena">
          {error && <div className="lobby-error">{error}</div>}

          <div className="lobby-fields">
            <label className="lobby-label">
              <span>Gladiator Name</span>
              <input
                className="lobby-input"
                type="text"
                maxLength={18}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your name"
              />
            </label>

            <button
              type="button"
              className="btn-primary-minimal lobby-create-btn"
              disabled={connecting}
              onClick={() => onCreate(name)}
            >
              {connecting ? "Entering Arena…" : "Enter the Arena"}
            </button>

            <div className="lobby-divider">
              <span>or join by code</span>
            </div>

            <form className="join-row" onSubmit={handleJoinSubmit}>
              <input
                className="lobby-input code-input"
                type="text"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="CODE"
                aria-label="Room code"
              />
              <button
                className="btn-ghost lobby-join-btn"
                type="submit"
                disabled={connecting || !code.trim()}
              >
                Join
              </button>
            </form>

            {shouldShowIosFullscreenTip() && (
              <p className="lobby-ios-note">
                <strong>iPhone / iPad Fullscreen:</strong> Open in <strong>Safari → Share → Add to Home Screen</strong> to play as a full-screen app with no browser UI.
              </p>
            )}
          </div>
        </section>
      </main>

      <footer className="lobby-footer-bar">
        <div className={`server-status status-${serverState}`}>
          <span className="status-dot" aria-hidden="true" />
          {serverState === "online"
            ? "Arena server online"
            : serverState === "waking"
              ? "Waking server…"
              : "Connecting…"}
        </div>
        <span className="lobby-edition">SekiroSlop</span>
      </footer>
    </div>
  );
}
