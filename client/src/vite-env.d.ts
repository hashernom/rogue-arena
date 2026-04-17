/// <reference types="vite/client" />

interface ImportMeta {
  readonly hot?: {
    accept: (callback?: (newModule: unknown) => void) => void;
    dispose: (callback: () => void) => void;
    decline: () => void;
    invalidate: () => void;
    on: (event: string, callback: (...args: unknown[]) => void) => void;
  };
}
