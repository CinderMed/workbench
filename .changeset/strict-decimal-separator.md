---
"@cindermed/model": patch
---

The decimal separator is strict: with `decimalSeparator: ","` a value containing `.` (`1.234`, `1.234,5`) is not a decimal, and with `.` a value containing `,` is not. Rule 9 (`ALLOWED_VALUE_TYPE_MISMATCH`) reports such allowed values.
