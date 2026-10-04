// Shared jsdom shims for component tests that mount Radix primitives
// (dropdown menu, dialog, tooltip) or chart containers. Radix relies on a
// few browser APIs jsdom does not implement. Install once per test file in
// beforeAll; every install is idempotent, so ordering with other shims is
// irrelevant.
export const installRadixShims = (): void => {
  const globals = globalThis as Record<string, unknown>;
  if (typeof globals.PointerEvent !== "function") {
    class PointerEventShim extends MouseEvent {
      pointerId: number;
      pointerType: string;
      isPrimary: boolean;
      constructor(type: string, params: PointerEventInit = {}) {
        super(type, params);
        this.pointerId = params.pointerId ?? 0;
        this.pointerType = params.pointerType ?? "";
        this.isPrimary = params.isPrimary ?? false;
      }
    }
    globals.PointerEvent = PointerEventShim;
  }
  const prototype = HTMLElement.prototype as unknown as Record<string, unknown>;
  prototype.hasPointerCapture ??= () => false;
  prototype.setPointerCapture ??= () => {};
  prototype.releasePointerCapture ??= () => {};
  prototype.scrollIntoView ??= () => {};
  globals.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // Blob URLs (export previews) have no jsdom implementation either.
  (URL as unknown as Record<string, unknown>).createObjectURL ??= () => "blob:fixture";
  (URL as unknown as Record<string, unknown>).revokeObjectURL ??= () => {};
};
