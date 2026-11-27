import { useEffect, useRef, useState } from "react";
import type { PartyChatMessage } from "@sekiroslop/shared";

interface PartyChatProps {
  messages: PartyChatMessage[];
  sessionId: string;
  showTouch?: boolean;
  forceClosed?: boolean;
  onSend: (text: string) => void;
}

const PASSIVE_FADE_MS = 7000;

/**
 * Valorant-style bottom-left in-place chat:
 * - Press `Enter` anywhere in-game to open input, type, and press `Enter` to send & close
 *   (or `Enter` on empty / `Escape` to close immediately).
 * - When closed, recent messages stay visible for 7s at bottom-left and fade out cleanly.
 */
export function PartyChat({ messages, sessionId, showTouch = false, forceClosed = false, onSend }: PartyChatProps) {
  const [active, setActive] = useState(false);
  const [draft, setDraft] = useState("");
  const [nowTick, setNowTick] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (forceClosed && active) {
      setActive(false);
    }
  }, [forceClosed, active]);

  // Refresh passive message fade visibility while recent messages exist
  useEffect(() => {
    if (active || messages.length === 0) return;
    const newest = messages[messages.length - 1];
    const age = Date.now() - newest.sentAt;
    if (age >= PASSIVE_FADE_MS) return;
    setNowTick(Date.now());
    const timer = window.setTimeout(() => setNowTick(Date.now()), PASSIVE_FADE_MS - age + 60);
    return () => window.clearTimeout(timer);
  }, [messages, active]);

  // Global `Enter` key opens Valorant chat directly; `Escape` closes it
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Escape" && active) {
        e.preventDefault();
        e.stopPropagation();
        setActive(false);
        return;
      }

      if (e.code === "Enter" && !active && !e.repeat) {
        if (forceClosed) return;
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable)
        ) {
          return;
        }
        if (document.querySelector(".ui-modal-backdrop")) return;

        e.preventDefault();
        e.stopPropagation();
        if (document.pointerLockElement) {
          document.exitPointerLock();
        }
        setActive(true);
      }
    };

    const onPointerDownOutside = (e: MouseEvent) => {
      if (!active) return;
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setActive(false);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("mousedown", onPointerDownOutside);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("mousedown", onPointerDownOutside);
    };
  }, [active, forceClosed]);

  useEffect(() => {
    if (active) {
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
      });
    }
  }, [active]);

  useEffect(() => {
    if (active) {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, active]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (text) {
      onSend(text);
      setDraft("");
    }
    setActive(false);
  };

  const recentPassive = !active
    ? messages
        .filter((m) => nowTick - m.sentAt < PASSIVE_FADE_MS)
        .slice(-5)
    : [];

  return (
    <div
      ref={rootRef}
      className={`val-chat ${active ? "is-open" : "is-passive"}`}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {active ? (
        <>
          <div className="val-chat-history" ref={listRef} aria-live="polite">
            {messages.length === 0 ? (
              <div className="val-chat-empty">Party chat — press Esc to close</div>
            ) : (
              messages.map((m, idx) => (
                <div
                  key={`${m.sentAt}-${m.senderId}-${idx}`}
                  className={`val-chat-line ${m.senderId === sessionId ? "is-self" : ""}`}
                >
                  <span className="val-chat-tag">[Party]</span>{" "}
                  <b className="val-chat-author">{m.senderName}:</b>{" "}
                  <span className="val-chat-body">{m.text}</span>
                </div>
              ))
            )}
          </div>
          <form className="val-chat-input-bar" onSubmit={submit}>
            <span className="val-chat-prefix">Party:</span>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, 220))}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.code === "Escape") {
                  e.preventDefault();
                  setActive(false);
                }
              }}
              maxLength={220}
              placeholder="Send a message…"
              aria-label="Party chat message"
            />
          </form>
        </>
      ) : (
        <>
          {recentPassive.length > 0 && (
            <div className="val-chat-passive-feed" aria-live="polite">
              {recentPassive.map((m, idx) => (
                <div
                  key={`${m.sentAt}-${m.senderId}-${idx}`}
                  className={`val-chat-line ${m.senderId === sessionId ? "is-self" : ""}`}
                >
                  <span className="val-chat-tag">[Party]</span>{" "}
                  <b className="val-chat-author">{m.senderName}:</b>{" "}
                  <span className="val-chat-body">{m.text}</span>
                </div>
              ))}
            </div>
          )}
          {showTouch ? (
            <button
              type="button"
              className="val-chat-touch-btn"
              onClick={() => setActive(true)}
            >
              Chat
            </button>
          ) : (
            <div className="val-chat-hint">[Enter] Chat</div>
          )}
        </>
      )}
    </div>
  );
}
