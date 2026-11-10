// Parses FML files with the official grammar mapping.g4 (antlr-ng + antlr4ng). Usage: npx tsx tools/verify-grammar.ts <file.map>...
import { CharStream, CommonTokenStream, BaseErrorListener } from 'antlr4ng';
import { mappingLexer } from './gen/mappingLexer.js';
import { mappingParser } from './gen/mappingParser.js';
import fs from 'fs';
let errors: string[] = [];
class L extends BaseErrorListener { syntaxError(_r: any, _o: any, line: number, col: number, msg: string) { errors.push(`${line}:${col} ${msg}`); } }
for (const f of process.argv.slice(2)) {
  errors = [];
  const lexer = new mappingLexer(CharStream.fromString(fs.readFileSync(f, 'utf8')));
  lexer.removeErrorListeners(); lexer.addErrorListener(new L());
  const p = new mappingParser(new CommonTokenStream(lexer));
  p.removeErrorListeners(); p.addErrorListener(new L());
  const tree = p.structureMap();
  const groups = tree.groupDeclaration().length;
  console.log(`${f.split('/').pop()}: ${errors.length ? 'ERRORS\n  ' + errors.join('\n  ') : 'OK'} (groups: ${groups})`);
}
