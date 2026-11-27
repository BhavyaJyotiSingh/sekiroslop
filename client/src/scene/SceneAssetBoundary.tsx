import { Component, Suspense, type ReactNode } from "react";

interface SceneAssetBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  resetKey?: string | number;
}

interface SceneAssetBoundaryState {
  hasError: boolean;
  resetKey?: string | number;
}

/**
 * Isolates async R3F asset loads (`useGLTF`, `useLoader`) per entity or prop group
 * so spawning wave enemies, switching skins, or loading map props never suspends
 * or hides the rest of the 3D arena, and failed network fetches degrade gracefully.
 */
export class SceneAssetBoundary extends Component<
  SceneAssetBoundaryProps,
  SceneAssetBoundaryState
> {
  state: SceneAssetBoundaryState = {
    hasError: false,
    resetKey: this.props.resetKey,
  };

  static getDerivedStateFromProps(
    props: SceneAssetBoundaryProps,
    state: SceneAssetBoundaryState
  ): SceneAssetBoundaryState | null {
    if (props.resetKey !== state.resetKey) {
      return { hasError: false, resetKey: props.resetKey };
    }
    return null;
  }

  static getDerivedStateFromError(): Partial<SceneAssetBoundaryState> {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    console.warn("[SceneAssetBoundary] Asset load failed, keeping scene active:", error);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    return <Suspense fallback={this.props.fallback ?? null}>{this.props.children}</Suspense>;
  }
}
