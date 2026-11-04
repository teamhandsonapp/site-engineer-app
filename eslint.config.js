// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    rules: {
      // eslint-plugin-react-hooks v7's new "Compiler" ruleset flags the
      // standard `useEffect(() => { fetchData().finally(() => setLoading(false)) }, [dep])`
      // pattern used consistently (and correctly) across every data-
      // fetching screen in this app — confirmed by testing React's own
      // documented "ignore flag" mitigation (the rule's suggested
      // alternative) against it directly; it still flags the fetch call
      // itself, not just the setState. Satisfying it for real would mean
      // adopting a different data-fetching architecture (React Query,
      // Suspense) across the whole app — out of scope for an ESLint
      // adoption pass. Downgraded to a warning (kept visible, not
      // disabled outright) rather than silently ignored.
      'react-hooks/set-state-in-effect': 'warn',
      // Same v7 "Compiler" ruleset, same false-positive class: it flags any
      // react-native-reanimated SharedValue (`useSharedValue`) that's both
      // referenced inside a useEffect and mutated (`.value = ...`) anywhere
      // else in the component — e.g. a gesture handler — as an illegal
      // mutation of an "effect-tracked" value. That's exactly how
      // SharedValues are DESIGNED to be used (a deliberately mutable ref,
      // not reactive state); this rule has no model of Reanimated's API at
      // all, so there's no way to satisfy it while still using the library
      // (confirmed on components/flowchart/FlowchartCanvas.tsx's pinch/pan
      // gesture handlers, which mutate scale/translateX/translateY exactly
      // this way). Off, not just downgraded, since — unlike
      // set-state-in-effect above — there's no partial middle ground here.
      'react-hooks/immutability': 'off',
    },
  },
]);
