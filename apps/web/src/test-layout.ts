/**
 * Tests only: jsdom has no layout, so every element measures 0 × 0 and a virtualized grid would
 * render no rows. This gives elements a viewport of `viewportHeight` × `viewportWidth` (TanStack Virtual reads
 * clientHeight / clientWidth), a scrollable height from the virtualizer's sizer, and per-element
 * scrolling. Returns the function that undoes it.
 */
export function mockLayout(viewportHeight: number, viewportWidth = 1200): () => void {
  const proto = HTMLElement.prototype;
  const height = Object.getOwnPropertyDescriptor(proto, "clientHeight");
  const width = Object.getOwnPropertyDescriptor(proto, "clientWidth");
  Object.defineProperty(proto, "clientHeight", { configurable: true, get: () => viewportHeight });
  Object.defineProperty(proto, "clientWidth", { configurable: true, get: () => viewportWidth });
  // jsdom does not scroll elements (scrollTop stays 0): keep each element's offset, and make
  // scrollTo set it and fire the scroll event.
  const offsets = new WeakMap<Element, number>();
  const scrollTop = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
  Object.defineProperty(proto, "scrollTop", {
    configurable: true,
    get(this: HTMLElement) {
      return offsets.get(this) ?? 0;
    },
    set(this: HTMLElement, value: number) {
      offsets.set(this, value);
    },
  });
  // The scrollable height is the content's height (the virtualizer's sizer, the first child).
  const scrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight");
  Object.defineProperty(proto, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      const sizer = this.firstElementChild;
      return sizer instanceof HTMLElement ? Number.parseFloat(sizer.style.height) || 0 : 0;
    },
  });
  const scrollTo = Object.getOwnPropertyDescriptor(proto, "scrollTo");
  Object.defineProperty(proto, "scrollTo", {
    configurable: true,
    writable: true,
    value(this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = options.top ?? this.scrollTop;
      this.dispatchEvent(new Event("scroll"));
    },
  });
  return () => {
    if (height) Object.defineProperty(proto, "clientHeight", height);
    if (width) Object.defineProperty(proto, "clientWidth", width);
    Reflect.deleteProperty(proto, "scrollTop");
    Reflect.deleteProperty(proto, "scrollHeight");
    if (scrollHeight && !Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight"))
      Object.defineProperty(Element.prototype, "scrollHeight", scrollHeight);
    if (scrollTop && !Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop"))
      Object.defineProperty(Element.prototype, "scrollTop", scrollTop);
    if (scrollTo) Object.defineProperty(proto, "scrollTo", scrollTo);
    else Reflect.deleteProperty(proto, "scrollTo");
  };
}
