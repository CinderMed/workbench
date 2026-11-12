# FHIRPath in FML: identifiers with `_` as second character are rejected, and compiling drops delimited-identifier backticks

**Validator:** validator_cli 7.0.5 (org.hl7.fhir.core), Java 21, FHIR R4 (`-version=4.0.1`), no terminology server.
**Reproduction:** three one-file maps on the core `Basic` resource, each in its own folder (`repro1/Repro1.map`, `repro2/Repro2.map`, `control/Control.map`). No data, no custom definitions.

## Finding 1: the FHIRPath lexer rejects identifiers whose second character is `_`

Inside FHIRPath in FML (a `where` condition or an `evaluate` parameter), an identifier whose second character is `_`, or that starts with `_`, is rejected:

```
Error @7, 28: Found a_b expecting a token name
```

FHIRPath's grammar (`IDENTIFIER: ([A-Za-z] | '_')([A-Za-z0-9] | '_')*`) and the FML grammar (mapping.g4) both accept these names, and so does the HL7 FML parser for source paths (`src.a_b as v` compiles).

Observed with 7.0.5:

| Rejected                                         | Accepted                                     |
| ------------------------------------------------ | -------------------------------------------- |
| `a_b`, `a__`, `A_B`, `x_`, `a_`, `c__mood`, `_a` | `ab_c`, `a1_b`, `aB_c`, `a`, `X`, `ab`, `a1` |

Logical models generated from tabular data hit this often: a column `a b` or `a-b` becomes the element `a_b`.

`Repro1.map`:

```
map "http://example.org/StructureMap/Repro1" = "Repro1"

uses "http://hl7.org/fhir/StructureDefinition/Basic" alias Basic as source
uses "http://hl7.org/fhir/StructureDefinition/Basic" alias Basic as target

group Repro1(source src : Basic, target tgt : Basic) {
  src where ($this.a_b.exists()) -> tgt.id = 'x' "r1";
}
```

```sh
java -jar validator_cli.jar compile http://example.org/StructureMap/Repro1 -version=4.0.1 -tx=n/a -ig=repro1 -output=$PWD/Repro1.json
```

Result:

```
* load file: Repro1.fml - ignored due to error: Error @7, 28: Found a_b expecting a token name
java.lang.Exception: Unable to locate map http://example.org/StructureMap/Repro1
```

Control: the same map with `ab_c` instead of `a_b` compiles (`"condition" : "($this.ab_c.exists())"`). Side note: `compile` exits with status 0 even when the map is ignored.

## Finding 2: compiling to StructureMap JSON drops the backticks of delimited identifiers

With a delimited identifier (`` $this.`a_b` ``), the map compiles and runs correctly from the FML text. But the compiled StructureMap JSON stores the expression without the backticks. The map then fails with Finding 1's error whenever it is loaded from JSON (an IG, a FHIR server, Matchbox):

`Repro2.map`:

```
map "http://example.org/StructureMap/Repro2" = "Repro2"

uses "http://hl7.org/fhir/StructureDefinition/Basic" alias Basic as source
uses "http://hl7.org/fhir/StructureDefinition/Basic" alias Basic as target

group Repro2(source src : Basic, target tgt : Basic) {
  src where ($this.`a_b`.exists()) -> tgt.id = 'x' "r1";
}
```

```sh
java -jar validator_cli.jar compile http://example.org/StructureMap/Repro2 -version=4.0.1 -tx=n/a -ig=repro2 -output=$PWD/Repro2.json
```

`Repro2.json` contains:

```
"condition" : "($this.a_b.exists())"
```

Expected: ``"condition" : "($this.`a_b`.exists())"``, so that the JSON round-trips. When we added the backticks to the JSON by hand, the map loaded from JSON ran correctly.

## Expected behaviour

1. The FHIRPath lexer accepts identifiers per the FHIRPath `IDENTIFIER` rule, whatever the second character.
2. The StructureMap JSON (and the FML rendering of a StructureMap) keeps delimited identifiers delimited.
