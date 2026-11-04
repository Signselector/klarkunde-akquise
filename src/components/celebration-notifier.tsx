import { useCallback, useEffect, useRef, useState } from "react";
import { Trophy, X } from "@/components/coldcaller/icons";
import { supabase } from "@/integrations/supabase/client";
import { useCountry } from "@/lib/country";
import {
  CELEBRATION_EVENT,
  CELEBRATION_FADE_MS,
  CELEBRATION_SHOW_MS,
  CELEBRATION_TEXT,
  celebrationChannel,
  isCelebrationType,
  isOwnCelebration,
  type CelebrationType,
} from "@/lib/celebration";

const COLORS = [
  "#ef4444",
  "#f97316",
  "#facc15",
  "#22c55e",
  "#14b8a6",
  "#2563eb",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
];
const PIECES = 60;

/**
 * Live celebration for everybody who is online in the selected country at this moment. It listens on the country's
 * private Realtime broadcast channel: nothing is stored, so a user who logs in later or reloads gets nothing. The card
 * shows an anonymous fixed text, bursts confetti (not with "reduce motion") and disappears after exactly 3 seconds.
 */
export function CelebrationNotifier() {
  const country = useCountry();
  const [shown, setShown] = useState<{ id: number; type: CelebrationType } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const burst = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const counter = useRef(0);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  const close = useCallback(() => {
    clearTimers();
    setShown(null);
    setLeaving(false);
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel(celebrationChannel(country), {
        config: { private: true, broadcast: { self: false } },
      })
      .on("broadcast", { event: CELEBRATION_EVENT }, (message) => {
        const type = (message["payload"] as { type?: unknown } | null)?.type;
        if (!isCelebrationType(type) || isOwnCelebration(type)) return;
        clearTimers();
        counter.current += 1;
        setLeaving(false);
        setShown({ id: counter.current, type });
        // Soft fade for the last moments, gone after exactly 3 seconds.
        timers.current.push(
          window.setTimeout(() => setLeaving(true), CELEBRATION_SHOW_MS - CELEBRATION_FADE_MS),
        );
        timers.current.push(window.setTimeout(() => close(), CELEBRATION_SHOW_MS));
      })
      .subscribe();
    return () => {
      clearTimers();
      void supabase.removeChannel(channel);
    };
  }, [country, close]);

  const id = shown?.id;
  useEffect(() => {
    if (id === undefined) return;
    const host = burst.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animations: Animation[] = [];
    if (host && !reduce && typeof host.animate === "function") {
      for (let i = 0; i < PIECES; i++) {
        const el = document.createElement("i");
        el.className = "cc-confetti-piece";
        el.style.background = COLORS[i % COLORS.length]!;
        el.style.width = `${6 + (i % 3) * 2}px`;
        el.style.height = `${8 + (i % 4) * 2}px`;
        if (i % 4 === 0) el.style.borderRadius = "50%";
        host.appendChild(el);
        const angle = (Math.PI * 2 * i) / PIECES + Math.random() * 0.5;
        const dist = 80 + Math.random() * 130;
        const x = Math.cos(angle) * dist;
        const y = Math.sin(angle) * dist - 30;
        animations.push(
          el.animate(
            [
              { transform: "translate(0,0) rotate(0deg) scale(0.6)", opacity: 1 },
              {
                transform: `translate(${x}px,${y}px) rotate(300deg) scale(1)`,
                opacity: 1,
                offset: 0.55,
              },
              {
                transform: `translate(${x * 1.1}px,${y + 110}px) rotate(560deg) scale(0.9)`,
                opacity: 0,
              },
            ],
            {
              duration: 1000 + Math.random() * 700,
              easing: "cubic-bezier(0.23, 1, 0.32, 1)",
              fill: "forwards",
            },
          ),
        );
      }
    }
    return () => {
      animations.forEach((a) => a.cancel());
      host?.replaceChildren();
    };
  }, [id]);

  if (!shown) return null;
  return (
    <div className="cc-achievement-wrap cc-celebrate-wrap" aria-live="polite">
      <div
        key={shown.id}
        role="status"
        className={`cc-achievement cc-achievement--${shown.type === "won" ? "gold" : "blue"} ${leaving ? "cc-celebrate--out" : ""}`}
      >
        <div className="cc-achievement-icon">
          <Trophy aria-hidden="true" />
          <div ref={burst} className="cc-confetti" aria-hidden="true" />
        </div>
        <div className="cc-achievement-text">
          <strong>{CELEBRATION_TEXT[shown.type]}</strong>
        </div>
        <button
          type="button"
          className="cc-achievement-close"
          aria-label="Schließen"
          onClick={close}
        >
          <X aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
