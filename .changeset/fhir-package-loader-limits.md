---
"@cindermed/cli": patch
---

The FHIR package loader refuses tarballs with entries other than files and folders (symbolic and hard links, devices, FIFOs) or with paths outside their folder, limits downloads to 100 MB and extracted packages to 500 MB, and gives up on a registry request after 120 s, each with a clear error and nothing left in the cache.
