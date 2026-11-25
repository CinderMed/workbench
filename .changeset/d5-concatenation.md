---
"@cindermed/fml": minor
"@cindermed/web": minor
---

The generator writes the concatenation transform (D5, #98): `src where ($this.a.exists() or $this.b.exists()) -> res.element = evaluate(src, $this.a.toString().combine($this.b.toString()).join(' '))`. The columns are joined in the row's order with the separator (a space by default), empty columns are skipped, a decimal keeps its digits (`1.50`), and an all-empty row writes no element. A separator with `'` or a control character is written in base64 and decoded by FHIRPath, because the HL7 engine loses the escape of a quote. `cindermed export` no longer refuses concatenations (`TRANSFORM_UNSUPPORTED` stays for expert expressions). The grid's transform editor offers concatenation again.
