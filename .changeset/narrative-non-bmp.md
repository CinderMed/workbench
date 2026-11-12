---
"@cindermed/fml": patch
---

The StructureMap narrative writes code points above U+FFFF (emoji, for example) as numeric references such as `&#x1F600;`, as the HL7 engine does, so the JSON matches the engine's output. Accented letters stay as they are.
