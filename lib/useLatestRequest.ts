import { useCallback, useRef } from 'react';

// Guards against a slow, older response overwriting newer data — e.g. the
// user switches project and the previous project's request finishes last.
//
//   const latest = useLatestRequest();
//   const load = async () => {
//     const isCurrent = latest.begin();
//     const data = await fetchSomething();
//     if (!isCurrent()) return; // a newer load started — drop this result
//     setData(data);
//   };
export function useLatestRequest() {
  const counter = useRef(0);
  const begin = useCallback(() => {
    const id = ++counter.current;
    return () => id === counter.current;
  }, []);
  return { begin };
}
