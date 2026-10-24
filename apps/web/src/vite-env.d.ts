/// <reference types="vite/client" />
declare module "monaco-editor/editor/editor.api.js" {
  export * from "monaco-editor";
}
declare module "monaco-editor/language/json/monaco.contribution.js";
declare module "*?worker" {
  const W: { new (): Worker };
  export default W;
}
