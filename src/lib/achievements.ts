import { useSyncExternalStore } from "react";

/** A celebration the caller earned: shown one at a time, top right, with confetti. */
export type Achievement = { id: number; title: string; detail: string; tone: "gold" | "blue" };

let queue: Achievement[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function celebrate(a: Omit<Achievement, "id">) {
  queue = [...queue, { ...a, id: nextId++ }];
  emit();
}

export function dismissAchievement(id: number) {
  queue = queue.filter((a) => a.id !== id);
  emit();
}

const snapshot = () => queue[0] ?? null;
export function useCurrentAchievement() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    snapshot,
    () => null,
  );
}

export const STAGE_ACHIEVEMENT = {
  low_q: "Logo Render",
  high_q: "Realismus Render",
} as const;
