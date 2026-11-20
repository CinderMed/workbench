// jsdom lacks matchMedia, which Mantine uses for the color scheme (tests in the node environment
// have no window).
if (typeof window !== "undefined")
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });

// jsdom lacks ResizeObserver, which Mantine components (SegmentedControl) use.
if (typeof window !== "undefined" && !("ResizeObserver" in window))
  Object.defineProperty(window, "ResizeObserver", {
    writable: true,
    value: class {
      observe = () => undefined;
      unobserve = () => undefined;
      disconnect = () => undefined;
    },
  });
