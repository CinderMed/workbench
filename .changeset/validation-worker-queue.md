---
"@cindermed/web": patch
---

Inline validation: every run of the validation worker answers, with the error when a check fails (the summary says the check failed and why), a failed opening of the FHIR definitions is retried on the next run, and only the newest waiting request runs next, so fast edits never build a queue.
