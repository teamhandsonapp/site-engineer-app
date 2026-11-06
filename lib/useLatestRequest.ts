import { useCallback, useMemo, useRef } from 'react';

// Guards against a slow, older response overwriting newer data — e.g. the
// user switches project and the previous project's request finishes last.
//
//   const latest = useLatestRequest();
//   const load = useCallback(async () => {
//     const isCurrent = latest.begin();
//     const data = await fetchSomething();
//     if (!isCurrent()) return; // a newer load started — drop this result
//     setData(data);
//   }, [latest]);
//
// The returned object MUST stay the same across renders: callers list it in
// their useCallback deps, and a new object each render made `load` change
// every render, so useEffect([load]) refetched forever (Nov 2026 loop on
// Engineer Attendance, Completed Tasks, Documents and the engineer detail
// screen). scripts/test-request-budget.mjs guards against it coming back.
export function useLatestRequest() {
  const counter = useRef(0);
  const begin = useCallback(() => {
    const id = ++counter.current;
    return () => id === counter.current;
  }, []);
  return useMemo(() => ({ begin }), [begin]);
}
