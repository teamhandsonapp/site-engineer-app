import { Component, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { logError } from '../lib/sentryLog';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// Catches unexpected render-time errors anywhere below it so a real crash
// shows a genuine recovery screen instead of RN's raw dev red-screen (or a
// blank white screen in a production build, where that red-screen doesn't
// exist at all). "Try Again" resets the boundary and re-renders the tree —
// this app has no remote crash-reporting or expo-updates dependency, so
// that's the honest ceiling of "reload" available here; it is NOT a full
// native app restart.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Always logged, never gated behind __DEV__ — a caught crash is
    // exactly the signal worth keeping even in production. Reported to
    // Sentry (with the breadcrumb trail leading up to it attached
    // automatically) as well as console.error, not console.error alone —
    // an error caught here and only printed locally would never appear in
    // the dashboard at all.
    console.error('[ErrorBoundary] Uncaught render error:', error, info.componentStack);
    logError(error, 'render_error_boundary', { componentStack: info.componentStack ?? undefined });
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <View className="flex-1 items-center justify-center bg-brand-navy px-8">
          <Text className="text-lg font-semibold text-white text-center mb-2">Something went wrong</Text>
          <Text className="text-sm text-white/60 text-center leading-[19px] mb-6">
            The app hit an unexpected error. Try again, or contact your admin if this keeps happening.
          </Text>
          <Pressable
            onPress={this.handleReset}
            className="px-6 py-3 rounded-xl bg-brand-amber"
            style={{ minHeight: 48, justifyContent: 'center' }}
          >
            <Text className="text-sm font-semibold text-brand-amber-deep">Try Again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}
