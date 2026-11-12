import { useLayoutEffect, useState } from "react";

let visit: { path: string; from: string | null } = { path: "", from: null };

export function usePageOrigin(path: string) {
  const [from, setFrom] = useState(() => visit.path === path ? visit.from : visit.path || null);
  useLayoutEffect(() => {
    if (visit.path !== path) visit = { path, from: visit.path || null };
    setFrom(visit.from);
  }, [path]);
  return from;
}
