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
  atlasId: string;
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
          atlasId: el.getAttribute("data-atlas-id") ?? "",
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

    function findByAtlasId(id: string): Element | null {
      return document.querySelector(`[data-atlas-id="${id}"]`);
    }

    function onMessage(ev: MessageEvent) {
      if (typeof ev.data !== "object" || ev.data === null) return;
      const data = ev.data as { type?: string; atlasId?: string; [k: string]: unknown };

      switch (data.type) {
        case "atlas-apply-class": {
          // Legacy: selector-based. Kept for backwards compat.
          const sel = data.selector as string | undefined;
          if (!sel) return;
          const el = document.querySelector(sel);
          if (!el) return;
          el.className = data.className as string;
          post();
          break;
        }
        case "atlas-apply-text": {
          const el = data.atlasId ? findByAtlasId(data.atlasId) : null;
          if (!el) return;
          el.textContent = data.newText as string;
          post();
          break;
        }
        case "atlas-replace-img": {
          const el = data.atlasId ? findByAtlasId(data.atlasId) : null;
          if (!el) return;
          // Fall back to a descendant <img> when the atlas-id lives on a
          // wrapper (e.g., <picture>, <a>, an aspect-ratio div). Common in
          // the Developer's generated JSX — the wrapper gets the atlas-id
          // because it's the first JSX element, and the img sits inside.
          const img =
            el instanceof HTMLImageElement
              ? el
              : (el.querySelector("img") as HTMLImageElement | null);
          if (!img) return;
          img.src = data.newUrl as string;
          if (typeof data.newAlt === "string") img.alt = data.newAlt;
          post();
          break;
        }
        case "atlas-make-editable": {
          const el = data.atlasId ? findByAtlasId(data.atlasId) : null;
          if (!el || !(el instanceof HTMLElement)) return;
          el.contentEditable = "true";
          el.focus();
          const onBlur = () => {
            el.contentEditable = "false";
            el.removeEventListener("blur", onBlur);
            window.parent.postMessage(
              {
                type: "atlas-text-committed",
                atlasId: data.atlasId,
                newText: (el.textContent ?? "").trim()
              },
              "*"
            );
          };
          el.addEventListener("blur", onBlur);
          break;
        }
        case "atlas-revert-text": {
          const el = data.atlasId ? findByAtlasId(data.atlasId) : null;
          if (!el) return;
          el.textContent = data.oldText as string;
          post();
          break;
        }
      }
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
