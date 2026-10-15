import React from 'react';
import { StatusBar } from 'expo-status-bar';
import RootNavigator from './src/navigation/RootNavigator';
import { ThemeProvider } from './src/theme/ThemeContext';
import ErrorBoundary from './src/components/ErrorBoundary';

export default function App() {
  return (
    <ThemeProvider>
      <StatusBar style="light" />
      <ErrorBoundary>
        <RootNavigator />
      </ErrorBoundary>
    </ThemeProvider>
  );
}
