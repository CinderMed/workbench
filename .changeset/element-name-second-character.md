---
"@cindermed/fml": patch
---

Element names now start with a letter followed, if there is more, by a letter or a digit: the prefix `c` is added as many times as needed (`a b` → `ca_b`, `😀 mood` → `cc__mood`, `a` stays `a`). The HL7 FHIRPath parser rejects names whose second character is `_`, so maps with such a column in a creation condition did not compile (#134). Names that compiled before do not change.
