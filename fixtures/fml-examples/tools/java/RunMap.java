// Runs an FML StructureMap on a normalized row with the HL7 reference engine (org.hl7.fhir.core),
// without a terminology server: ConceptMaps are local. Then validates the produced Bundle.
// Usage: java -cp validator_cli.jar:. RunMap <ig-folder> <map-url> <input.json> <output.json>
import org.hl7.fhir.validation.*;
import org.hl7.fhir.services.fml.StructureMapTools;
import org.hl7.fhir.services.elementmodel.*;
import org.hl7.fhir.model.Base;
import org.hl7.fhir.model.core.*;
import org.hl7.fhir.model.fml.StructureMap;
import org.hl7.fhir.model.utilities.formats.*;
import java.io.*; import java.nio.file.*; import java.util.*;

public class RunMap {
  public static void main(String[] a) throws Exception {
    ValidationEngine ve = new ValidationEngine.ValidationEngineBuilder().withVersion("4.0.1").withNoTerminologyServer().fromSource("hl7.fhir.r4.core#4.0.1");
    ve.getIgLoader().loadIg(ve.getIgs(), ve.getBinaries(), a[0], false);
    var ctx = ve.getContext();
    List<Base> outputs = new ArrayList<>();
    StructureMapTools smt = new StructureMapTools(ctx, new TransformSupportServices(outputs, new PrintWriter(System.out, true), ctx));
    StructureMap map = ctx.fetchResource(StructureMap.class, a[1]);
    if (map == null) throw new RuntimeException("Map not found: " + a[1]);
    org.hl7.fhir.services.elementmodel.Element src = Manager.parseSingle(ctx, new FileInputStream(a[2]), FhirFormat.JSON);
    org.hl7.fhir.services.elementmodel.Element tgt = Manager.build(ctx, ctx.fetchTypeDefinition("Bundle"));
    smt.transform(null, src, map, tgt);
    ByteArrayOutputStream bo = new ByteArrayOutputStream();
    Manager.compose(ctx, tgt, bo, FhirFormat.JSON, OutputStyle.PRETTY, null);
    Files.write(Paths.get(a[3]), bo.toByteArray());
    System.out.println("Bundle written to " + a[3]);
    OperationOutcome oo = ve.validate(bo.toByteArray(), FhirFormat.JSON, new ArrayList<>(), new ArrayList<>());
    int err = 0, warn = 0;
    for (var i : oo.getIssueList()) {
      String sev = i.getSeverity().toCode();
      if (sev.equals("error") || sev.equals("fatal")) err++; else if (sev.equals("warning")) warn++;
      if (!sev.equals("information")) System.out.println("  [" + sev + "] " + (i.getExpressionList().isEmpty() ? "" : i.getExpressionList().get(0).getValue()) + " " + (i.getDetails() != null && i.getDetails().getText() != null ? i.getDetails().getText() : i.getDiagnostics()));
    }
    System.out.println("Bundle validation: " + err + " errors, " + warn + " warnings");
  }
}
