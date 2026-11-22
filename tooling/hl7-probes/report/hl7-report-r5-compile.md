# FML `compile -version=5.0.0` writes a StructureMap that does not validate as R5

**Validator:** validator_cli 7.0.5 (org.hl7.fhir.core), Java 21, FHIR R5 (`-version=5.0.0`), no terminology server.
**Reproduction:** one map on the core `Basic` resource (`r5compile/R5Compile.map`). No data, no custom definitions.

```
map "http://example.org/StructureMap/R5Compile" = "R5Compile"

uses "http://hl7.org/fhir/StructureDefinition/Basic" alias BasicIn as source
uses "http://hl7.org/fhir/StructureDefinition/Basic" alias BasicOut as target

group R5Compile(source src : BasicIn, target tgt : BasicOut) {
  // copy the id when there is one
  src.id as v where (v.exists()) -> tgt.id = v "copy-id";
}
```

```sh
java -jar validator_cli.jar compile http://example.org/StructureMap/R5Compile -version=5.0.0 -tx=n/a -ig=r5compile -output=$PWD/R5Compile.json
java -jar validator_cli.jar R5Compile.json -version 5.0.0 -tx n/a
```

## Finding 1: the R5 compilation is not valid R5

Validating the compiled map as R5 gives 4 errors (111 on a larger map with 4 groups):

```
Error @ $: The 'resourceDefinition' is 'http://hl7.org/fhir/StructureDefinition/StructureMap|0.1.0', but no additional resource is known for that reference
Error @ StructureMap.group[0].rule[0].source[0].element: This property must be a simple value, not an Array
Error @ StructureMap.group[0].rule[0].target[0].element: This property must be a simple value, not an Array
Error @ StructureMap: The value for resourceDefinition of 'http://hl7.org/fhir/StructureDefinition/StructureMap|0.1.0' does not match the required value of 'http://hl7.org/fhir/StructureDefinition/StructureMap|5.0.0'. ...
```

- `source.element` and `target.element` are written as one-item arrays (`["id"]`); R5 defines `element` as a single `string` (0..1).
- `resourceDefinition` is set to `http://hl7.org/fhir/StructureDefinition/StructureMap|0.1.0`; `StructureMap` is not an additional resource.

## Finding 2: the R5 compilation differs from the R4 one in ways the map does not ask for

The same map compiled with `-version=4.0.1` and with `-version=5.0.0`:

|                                | R4             | R5                                                                         |
| ------------------------------ | -------------- | -------------------------------------------------------------------------- |
| rule name `"copy-id"`          | `copy-id`      | `copyid` (the `-` is dropped; R5 `rule.name` is an `id`, which allows `-`) |
| condition `where (v.exists())` | `(v.exists())` | `v.exists()`                                                               |
| `// comment` before the rule   | not written    | `rule.documentation`                                                       |
| narrative (`text`)             | written        | not written                                                                |

None of these makes the R5 map invalid, but a rule name that loses its `-` no longer matches the name in the FML, so tools that refer to rules by name (traces, reports) see a different name than the author wrote.

## What still works

The engine runs both its own R5 compilation and the `.map` text correctly: on our larger map, the Bundles from the `.map` text, from the engine's compilation and from a StructureMap built to validate as R5 are identical and validate in R5 with 0 errors. The defects matter when the compiled StructureMap is itself validated or stored, for example on a FHIR server that validates on write.

## Question

Is the R5 serialization of `compile` known to be incomplete? A fix for findings 1 and the rule names in finding 2 would let R5 users publish the compiled StructureMap as it is.
