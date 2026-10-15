import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    if (__DEV__) {
      console.warn('[ErrorBoundary]', error, errorInfo?.componentStack);
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>
            An unexpected error occurred. You can try again or restart the app.
          </Text>
          <TouchableOpacity style={styles.button} onPress={this.handleRetry} accessible accessibilityRole="button" accessibilityLabel="Try again">
            <Text style={styles.buttonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#0B3D2E' },
  title: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', marginBottom: 8 },
  message: { fontSize: 14, color: '#A7F3D0', textAlign: 'center', marginBottom: 24 },
  button: { backgroundColor: '#FFFFFF', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  buttonText: { fontSize: 16, fontWeight: '700', color: '#0B3D2E' },
});

export default ErrorBoundary;
