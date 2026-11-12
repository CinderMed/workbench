---
"@cindermed/fml": minor
---

`generateMap` writes value maps (one rule per value; `use` with `also`, `setElement`, `skipInstance` in the role condition, `absent`), quantities with a fixed unit or a unit value map, and the `repeat eachValue` comment. Rule names are checked within each group (`DUPLICATE_RULE_NAME`), and a `use` entry without a target is `VALUE_MAP_ENTRY_WITHOUT_TARGET`.
