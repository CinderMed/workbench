// HL7 probe (#134): for every probe map, the HL7 engine parses it (the parser of the `compile`
// command), runs it on a full and an empty row, writes the StructureMap JSON (as `compile` does),
// reads that JSON back and runs it again. One tab-separated line per map on standard output.
// Usage: java -cp validator_cli.jar:<classes> Probe <ig-folder> <maps-folder> <full.json> <empty.json>
import org.hl7.fhir.validation.*;
import org.hl7.fhir.standalone.context.SimpleWorkerContext;
import org.hl7.fhir.model.ModelContext;
import org.hl7.fhir.services.fml.StructureMapTools;
import org.hl7.fhir.services.elementmodel.*;
import org.hl7.fhir.model.core.formats.JsonParser;
import org.hl7.fhir.model.fml.StructureMap;
import org.hl7.fhir.model.utilities.formats.*;
import java.io.*; import java.nio.file.*; import java.util.*; import java.util.regex.*;

public class Probe {
  public static void main(String[] a) throws Exception {
    ValidationEngine ve = new ValidationEngine.ValidationEngineBuilder().withVersion("4.0.1").withNoTerminologyServer().fromSource("hl7.fhir.r4.core#4.0.1");
    ve.getIgLoader().loadIg(ve.getIgs(), ve.getBinaries(), a[0], false);
    SimpleWorkerContext ctx = ve.getContext();
    File[] maps = new File(a[1]).listFiles((d, n) -> n.endsWith(".map"));
    Arrays.sort(maps);
    System.out.println("map\tcompile\tfromText\tjsonExpression\tfromJson");
    for (File f : maps) {
      String id = f.getName().replace(".map", "");
      StructureMapTools smt = tools(ctx);
      StructureMap map;
      try {
        map = smt.parse(Files.readString(f.toPath()), id);
      } catch (Exception e) {
        System.out.println(id + "\t" + oneLine(e.getMessage()) + "\t-\t-\t-");
        continue;
      }
      String fromText = run(ctx, smt, map, a[2]) + " | " + run(ctx, smt, map, a[3]);
      String json = new JsonParser(ModelContext.fullCoreContext()).composeString(map);
      Matcher m = Pattern.compile("\\$this[^\"]*").matcher(json);
      String expression = m.find() ? m.group() : "-";
      StructureMap reread = (StructureMap) new JsonParser(ModelContext.fullCoreContext()).parse(json.getBytes("UTF-8"));
      StructureMapTools fresh = tools(ctx);
      String fromJson = run(ctx, fresh, reread, a[2]) + " | " + run(ctx, fresh, reread, a[3]);
      System.out.println(id + "\tok\t" + fromText + "\t" + expression + "\t" + fromJson);
    }
  }

  static StructureMapTools tools(SimpleWorkerContext ctx) {
    return new StructureMapTools(ctx, new TransformSupportServices(new ArrayList<>(), new PrintWriter(new StringWriter(), true), ctx));
  }

  /** The ids of the Patients the map creates from a row ("none" if it creates none), or the error. */
  static String run(SimpleWorkerContext ctx, StructureMapTools smt, StructureMap map, String row) {
    try {
      Element src = Manager.parseSingle(ctx, new FileInputStream(row), FhirFormat.JSON);
      Element tgt = Manager.build(ctx, ctx.fetchTypeDefinition("Bundle"));
      smt.transform(null, src, map, tgt);
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      Manager.compose(ctx, tgt, out, FhirFormat.JSON, OutputStyle.NORMAL, null);
      var bundle = com.google.gson.JsonParser.parseString(out.toString("UTF-8")).getAsJsonObject();
      if (!bundle.has("entry")) return "none";
      List<String> ids = new ArrayList<>();
      for (var e : bundle.getAsJsonArray("entry")) ids.add(e.getAsJsonObject().getAsJsonObject("resource").get("id").getAsString());
      return String.join(",", ids);
    } catch (Exception e) {
      Throwable cause = e;
      while (cause.getCause() != null) cause = cause.getCause();
      return "error: " + oneLine(cause.getMessage());
    }
  }

  static String oneLine(String s) { return String.valueOf(s).replaceAll("\\s+", " ").trim(); }
}
