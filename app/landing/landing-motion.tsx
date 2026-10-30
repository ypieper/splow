"use client";

import { useEffect, type ReactNode } from "react";

export function LandingMotion({ children }: { children: ReactNode }) {
  useEffect(() => {
    const page = document.querySelector<HTMLElement>(".landing-page");
    if (!page) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) return;

    const revealItems = [...page.querySelectorAll<HTMLElement>(".landing-reveal")];
    const storySteps = [...page.querySelectorAll<HTMLElement>("[data-story-step]")];
    const storyVisual = page.querySelector<HTMLElement>(".landing-story-visual");
    const thread = document.querySelector<HTMLElement>(".landing-scroll-thread");
    let observer: IntersectionObserver | null = null;
    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          observer?.unobserve(entry.target);
        }
      }, { threshold: 0.01, rootMargin: "0px" });
      revealItems.forEach((item) => observer?.observe(item));
    } else {
      revealItems.forEach((item) => item.classList.add("is-visible"));
    }

    page.classList.add("landing-motion-ready");

    // Reveal content already in view immediately, including tall cards that may
    // never reach a larger IntersectionObserver threshold on short screens.
    const viewportHeight = window.innerHeight;
    revealItems.forEach((item) => {
      const { top, bottom } = item.getBoundingClientRect();
      if (top < viewportHeight && bottom > 0) item.classList.add("is-visible");
    });

    let frame = 0;
    const updateProgress = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const scrollRoot = document.scrollingElement ?? document.documentElement;
        const scrollable = scrollRoot.scrollHeight - scrollRoot.clientHeight;
        const scrollTop = scrollRoot.scrollTop;
        const progress = scrollable > 0 ? Math.min(1, Math.max(0, scrollTop / scrollable)) : 0;
        document.documentElement.style.setProperty("--splow-scroll-progress", String(progress));
        thread?.style.setProperty("--splow-progress-percent", `${progress * 100}%`);
        page.style.setProperty("--landing-orbit-one-y", `${Math.min(scrollTop, 700) * 0.045}px`);
        page.style.setProperty("--landing-orbit-two-y", `${Math.min(scrollTop, 700) * -0.07}px`);

        if (storyVisual && storySteps.length > 0) {
          const focusLine = window.innerHeight * 0.46;
          const activeStep = storySteps.reduce((closest, step) => {
            const closestDistance = Math.abs(closest.getBoundingClientRect().top + closest.offsetHeight / 2 - focusLine);
            const stepDistance = Math.abs(step.getBoundingClientRect().top + step.offsetHeight / 2 - focusLine);
            return stepDistance < closestDistance ? step : closest;
          });
          const nextIndex = activeStep.dataset.storyStep ?? "0";
          if (storyVisual.dataset.activeStep !== nextIndex) {
            storySteps.forEach((step) => step.classList.toggle("is-active", step === activeStep));
            storyVisual.dataset.activeStep = nextIndex;
          }
        }
      });
    };
    updateProgress();
    window.addEventListener("scroll", updateProgress, { passive: true });
    document.addEventListener("scroll", updateProgress, { passive: true, capture: true });
    window.addEventListener("resize", updateProgress);

    return () => {
      observer?.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updateProgress);
      document.removeEventListener("scroll", updateProgress, true);
      window.removeEventListener("resize", updateProgress);
      page.classList.remove("landing-motion-ready");
      page.style.removeProperty("--landing-orbit-one-y");
      page.style.removeProperty("--landing-orbit-two-y");
      document.documentElement.style.removeProperty("--splow-scroll-progress");
    };
  }, []);

  return <>{children}<div className="landing-scroll-thread" aria-hidden="true"><span/><i/></div></>;
}
