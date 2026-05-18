/** Typed wrappers around `iframe.contentWindow.postMessage`. React components
 *  call these instead of constructing message payloads inline — keeps the
 *  message shape in one file, so the bridge contract evolves cleanly. */

function post(iframe: HTMLIFrameElement, message: Record<string, unknown>): void {
  iframe.contentWindow?.postMessage(message, "*");
}

export function bridgeApplyText(
  iframe: HTMLIFrameElement,
  input: { atlasId: string; newText: string }
): void {
  post(iframe, { type: "atlas-apply-text", atlasId: input.atlasId, newText: input.newText });
}

export function bridgeReplaceImg(
  iframe: HTMLIFrameElement,
  input: { atlasId: string; newUrl: string; newAlt?: string }
): void {
  post(iframe, {
    type: "atlas-replace-img",
    atlasId: input.atlasId,
    newUrl: input.newUrl,
    ...(input.newAlt !== undefined ? { newAlt: input.newAlt } : {})
  });
}

export function bridgeMakeEditable(
  iframe: HTMLIFrameElement,
  input: { atlasId: string }
): void {
  post(iframe, { type: "atlas-make-editable", atlasId: input.atlasId });
}

export function bridgeRevertText(
  iframe: HTMLIFrameElement,
  input: { atlasId: string; oldText: string }
): void {
  post(iframe, { type: "atlas-revert-text", atlasId: input.atlasId, oldText: input.oldText });
}

export function bridgeApplyClass(
  iframe: HTMLIFrameElement,
  input: { selector: string; className: string }
): void {
  post(iframe, { type: "atlas-apply-class", selector: input.selector, className: input.className });
}
