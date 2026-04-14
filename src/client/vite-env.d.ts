/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PARTYKIT_HOST?: string;
  readonly VITE_ENABLE_SKIRMISH_ONLY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
