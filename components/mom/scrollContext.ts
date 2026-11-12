import { createContext, useContext } from 'react';

// The MoM screen's ScrollView, so a form inside it can scroll to its first
// error. `y` is measured from the top of the scroll content.
export type MomScrollTo = (y: number) => void;

export const MomScrollContext = createContext<MomScrollTo | null>(null);

export function useMomScrollTo(): MomScrollTo {
  return useContext(MomScrollContext) ?? (() => {});
}
