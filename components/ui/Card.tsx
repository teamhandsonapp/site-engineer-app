import { View, type ViewProps } from 'react-native';

// One shared card shell — no card component existed before this pass (each
// screen inlined its own radius/border/padding ad hoc). Real elevation, not
// just a border, so cards read as physically distinct surfaces against the
// neutral-50 page background both home screens use.
export function Card({ style, accentColor, className, children, ...rest }: ViewProps & { accentColor?: string }) {
  return (
    <View
      className={`rounded-2xl bg-white border border-neutral-100 p-4 ${className ?? ''}`}
      style={[
        {
          shadowColor: '#0F1F33',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.06,
          shadowRadius: 6,
          elevation: 1,
        },
        accentColor ? { borderLeftWidth: 3, borderLeftColor: accentColor } : null,
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}
