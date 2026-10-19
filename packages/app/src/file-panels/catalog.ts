import { filePanelExtension, type FilePanelCandidate } from "./resolve";

export const builtinFilePanels = [
  {
    id: "builtin:markdown",
    files: { extensions: ["md", "markdown"] },
    document: "text",
    maxBytes: Infinity,
  },
  {
    id: "builtin:html",
    files: { extensions: ["html", "htm"] },
    document: "text",
    maxBytes: Infinity,
  },
  {
    id: "builtin:image",
    files: { extensions: [], kind: "image" },
    document: "bytes",
    maxBytes: Infinity,
  },
] as const satisfies readonly FilePanelCandidate[];

export function isRenderedMarkdownFile(path: string): boolean {
  return builtinFilePanels[0].files.extensions.some(
    (extension) => extension === filePanelExtension(path),
  );
}
