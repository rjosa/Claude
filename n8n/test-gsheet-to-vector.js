// Prueba local: node n8n/test-gsheet-to-vector.js
// Simula el `$input` de n8n y ejecuta el script del Code node.
const fs = require('fs');
const path = require('path');

const rows = [
  { row_number: 2, 'ID': 'P-001', 'Título': 'Política de devoluciones', 'Categoría': 'Soporte', 'Descripción': 'Se aceptan devoluciones hasta 30 días después de la compra. '.repeat(30) },
  { row_number: 3, 'ID': 'P-002', 'Título': '  Envíos  ', 'Categoría': 'Logística', 'Descripción': 'Envíos a todo el país en 48 a 72 hs.' },
  { row_number: 4, 'ID': '', 'Título': '', 'Categoría': 'N/A', 'Descripción': '' }, // vacía
  { row_number: 5, 'ID': 'P-002', 'Título': 'Envíos', 'Categoría': 'Logística', 'Descripción': 'Envíos a todo el país en 48 a 72 hs.' }, // duplicada
];

let code = fs.readFileSync(path.join(__dirname, 'gsheet-to-vector.js'), 'utf8')
  .replace("TEXT_COLUMNS: null", "TEXT_COLUMNS: ['Título', 'Categoría', 'Descripción']")
  .replace("METADATA_COLUMNS: null", "METADATA_COLUMNS: ['Categoría']")
  .replace("ID_COLUMN: null", "ID_COLUMN: 'ID'");

const $input = { all: () => rows.map((json) => ({ json })) };
const result = new Function('$input', code)($input);

console.log(JSON.stringify(result.map((r) => r.json), null, 2));
console.log(`\n${rows.length} filas -> ${result.length} fragmentos`);
