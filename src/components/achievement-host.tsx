import { useEffect, useRef } from "react";
import { Trophy, X } from "@/components/coldcaller/icons";
import { dismissAchievement, useCurrentAchievement } from "@/lib/achievements";

const SHOW_MS = 9000;
const COLORS = ["#2563eb", "#60a5fa", "#fbbf24", "#f59e0b", "#34d399", "#f472b6", "#ffffff"];
const PIECES = 42;

/**
 * Achievement card (top right) with a confetti burst out of its trophy. Rare moment, so it may be a little loud:
 * the card slides in over 280 ms, the confetti flies 1.1 to 1.9 s. Only transform and opacity move. With
 * "reduce motion" the card just fades in and there is no confetti.
 */
export function AchievementHost() {
  const current = useCurrentAchievement();
  const burst = useRef<HTMLDivElement>(null);
  const id = current?.id;

  useEffect(() => {
    if (id === undefined) return;
    const timer = window.setTimeout(() => dismissAchievement(id), SHOW_MS);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const host = burst.current;
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
        const dist = 90 + Math.random() * 150;
        const x = Math.cos(angle) * dist;
        const y = Math.sin(angle) * dist - 40;
        const spin = (Math.random() - 0.5) * 900;
        animations.push(
          el.animate(
            [
              { transform: "translate(0,0) rotate(0deg) scale(0.6)", opacity: 1 },
              { transform: `translate(${x}px,${y}px) rotate(${spin / 2}deg) scale(1)`, opacity: 1, offset: 0.55 },
              { transform: `translate(${x * 1.15}px,${y + 140}px) rotate(${spin}deg) scale(0.9)`, opacity: 0 },
            ],
            {
              duration: 1100 + Math.random() * 800,
              easing: "cubic-bezier(0.23, 1, 0.32, 1)",
              fill: "forwards",
              delay: Math.random() * 120,
            },
          ),
        );
      }
    }
    return () => {
      window.clearTimeout(timer);
      animations.forEach((a) => a.cancel());
      if (host) host.replaceChildren();
    };
  }, [id]);

  if (!current) return null;
  return (
    <div className="cc-achievement-wrap" aria-live="polite">
      <div key={current.id} className={`cc-achievement cc-achievement--${current.tone}`} role="status">
        <div className="cc-achievement-icon">
          <Trophy aria-hidden="true" />
          <div ref={burst} className="cc-confetti" aria-hidden="true" />
        </div>
        <div className="cc-achievement-text">
          <small>Errungenschaft freigeschaltet</small>
          <strong>{current.title}</strong>
          <span>{current.detail}</span>
        </div>
        <button
          type="button"
          className="cc-achievement-close"
          aria-label="Schließen"
          onClick={() => dismissAchievement(current.id)}
        >
          <X aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
