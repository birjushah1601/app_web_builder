declare module "iframe-resizer" {
  export function iframeResize(
    options: { log?: boolean; checkOrigin?: boolean; [key: string]: unknown },
    target: HTMLIFrameElement | string
  ): void;
}
