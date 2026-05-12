"use client";
/**
 * Atlas click-to-edit bridge.
 *
 * Mounted unconditionally inside the sandbox template's <RootLayout>. While
 * the sandbox boots a Next.js app for a normal preview, this client-only
 * component streams a flat DOM tree of "editable" elements (headings,
 * paragraphs, buttons, links, images, semantic sections) to the parent
 * window via `window.parent.postMessage`.
 *
 * Atlas-web's IframeOverlay (behind the ATLAS_FF_CLICK_TO_EDIT flag) listens
 * for those messages and renders hit-zones over the iframe so the user can
 * click an element to edit it. When the parent posts back an
 * "atlas-apply-class" message we patch the target element's className in
 * place and re-emit so the overlay tracks the new rect.
 *
 * Safe-by-default: when the iframe is opened top-level (no parent window),
 * `window.parent === window` and postMessage is a no-op listener for any
 * recipient — the bridge keeps observing the DOM but no harm done.
 */
import { useEffect } from "react";

interface AtlasDomNode {
  selector: string; // unique CSS path
  tag: string;
  text: string; // first 60 chars
  rect: { x: number; y: number; width: number; height: number };
  classes: string[];
}

export function AtlasEditBridge() {
  useEffect(() => {
    function pathFor(el: Element): string {
      const parts: string[] = [];
      let node: Element | null = el;
      while (node && node !== document.body) {
        const tag = node.tagName.toLowerCase();
        const idx = Array.from(node.parentElement?.children ?? []).indexOf(node) + 1;
        parts.unshift(`${tag}:nth-child(${idx})`);
        node = node.parentElement;
      }
      return parts.join(" > ");
    }
    function walk(): AtlasDomNode[] {
      const els = document.body.querySelectorAll(
        "h1, h2, h3, p, button, a, img, section, header, footer, nav"
      );
      return Array.from(els).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          selector: pathFor(el),
          tag: el.tagName.toLowerCase(),
          text: (el.textContent ?? "").trim().slice(0, 60),
          rect: {
            x: r.x + window.scrollX,
            y: r.y + window.scrollY,
            width: r.width,
            height: r.height
          },
          classes: Array.from(el.classList)
        };
      });
    }
    function post() {
      window.parent.postMessage({ type: "atlas-dom-tree", nodes: walk() }, "*");
    }
    post();
    const mo = new MutationObserver(() => post());
    mo.observe(document.body, { subtree: true, childList: true, attributes: true });
    const ro = new ResizeObserver(() => post());
    ro.observe(document.body);
    const onScroll = () => post();
    window.addEventListener("scroll", onScroll, { passive: true });

    function onMessage(ev: MessageEvent) {
      const data = ev.data as
        | { type?: string; selector?: string; className?: string }
        | null
        | undefined;
      if (!data || data.type !== "atlas-apply-class") return;
      if (typeof data.selector !== "string" || typeof data.className !== "string") return;
      const el = document.querySelector(data.selector);
      if (!el) return;
      el.className = data.className;
      post();
    }
    window.addEventListener("message", onMessage);
    return () => {
      mo.disconnect();
      ro.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("message", onMessage);
    };
  }, []);
  return null;
}
