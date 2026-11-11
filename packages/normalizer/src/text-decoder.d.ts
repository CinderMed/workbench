// TextDecoder (WHATWG Encoding Standard) is a global in Node and in browsers, but it is not part
// of the ES2023 library, and domain packages do not load Node or DOM types (ADR-0001). Only the
// members the normalizer uses are declared.
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  decode(input?: Uint8Array): string;
}
