import { useRef } from "react";
/** Keep the same key while retrying an unchanged form; clear only after confirmed success. */
export function useMutationRequest() {
  const pending = useRef<{ payload: string; id: string } | null>(null);
  return {
    idFor(payload: unknown) {
      const serialized = JSON.stringify(payload);
      if (pending.current?.payload !== serialized)
        pending.current = { payload: serialized, id: crypto.randomUUID() };
      return pending.current.id;
    },
    complete() {
      pending.current = null;
    },
  };
}
