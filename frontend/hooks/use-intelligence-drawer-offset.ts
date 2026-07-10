"use client";

import { useEffect, useState } from "react";

const DRAWER_SELECTOR = "[data-intelligence-drawer]";
const DRAWER_MARGIN_PX = 20;
const PANEL_MAX_WIDTH_PX = 384; // 24rem
const VIEWPORT_EDGE_MARGIN_PX = 24;

function clampOffset(drawerWidth: number): number {
  const desired = Math.ceil(drawerWidth) + DRAWER_MARGIN_PX;
  if (typeof window === "undefined") return desired;
  const maxShift = Math.max(
    0,
    window.innerWidth - PANEL_MAX_WIDTH_PX - VIEWPORT_EDGE_MARGIN_PX - 24
  );
  return Math.min(desired, maxShift);
}

/**
 * Horizontal offset so Ask Rana sits just left of the intelligence drawer.
 * Measures the live drawer width (responsive) plus a fixed margin.
 */
export function useIntelligenceDrawerOffset(drawerOpen: boolean): number {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (!drawerOpen) {
      setOffset(0);
      return;
    }

    let cancelled = false;

    const measure = () => {
      if (cancelled) return;
      const el = document.querySelector(DRAWER_SELECTOR);
      if (!el) {
        setOffset(0);
        return;
      }
      const width = el.getBoundingClientRect().width;
      setOffset(clampOffset(width));
    };

    measure();
    const raf = requestAnimationFrame(measure);
    const retry = window.setTimeout(measure, 50);

    const el = document.querySelector(DRAWER_SELECTOR);
    if (!el) {
      return () => {
        cancelled = true;
        cancelAnimationFrame(raf);
        window.clearTimeout(retry);
      };
    }

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(retry);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [drawerOpen]);

  return offset;
}
