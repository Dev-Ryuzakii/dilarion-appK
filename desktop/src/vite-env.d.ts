/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE: string;
  readonly VITE_WS_BASE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Baked in by Vite `define` from tauri.conf.json version.
declare const __APP_VERSION__: string;
