/**
 * n8n Code node: prepara filas de Google Sheets para una base de datos vectorial.
 *
 * Uso: Google Sheets (Get Rows) -> Code (este script, modo "Run Once for All Items")
 *      -> Vector Store (Pinecone / Qdrant / Supabase / PGVector...) con
 *         Default Data Loader en modo "Load Specific Data" usando {{ $json.pageContent }}
 *         y los campos de `metadata` como metadatos.
 *
 * Cada item de salida tiene la forma:
 *   { id, pageContent, metadata: { ...columnas elegidas, row_number, chunk_index, chunk_total, source } }
 */

// ───────────────────────── Configuración ─────────────────────────
const CONFIG = {
  // Columnas que forman el texto a vectorizar. null = todas las que no estén en EXCLUDE_COLUMNS.
  TEXT_COLUMNS: null,
  // Columnas que se guardan como metadatos (para filtrar en la búsqueda). null = ninguna extra.
  METADATA_COLUMNS: null,
  // Columnas que nunca se usan como texto (ids internos, URLs, timestamps...).
  EXCLUDE_COLUMNS: ['row_number'],
  // Columna con un identificador estable de la fila. null = se usa row_number.
  ID_COLUMN: null,
  // Nombre de la fuente que se guarda en los metadatos.
  SOURCE: 'google_sheets',
  // Tamaño máximo de cada fragmento (en caracteres) y solapamiento entre fragmentos.
  CHUNK_SIZE: 1000,
  CHUNK_OVERLAP: 150,
  // Mínimo de caracteres útiles para considerar una fila.
  MIN_TEXT_LENGTH: 3,
};

// ───────────────────────── Utilidades ─────────────────────────

// Normaliza el nombre de una columna a snake_case sin tildes: "Fecha de Alta" -> "fecha_de_alta"
function normalizeKey(key) {
  return String(key)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Limpia un valor de celda: recorta espacios, colapsa saltos de línea y descarta vacíos.
function cleanValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const text = String(value)
    .replace(/ /g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text === '' || ['n/a', 'na', '-', 'null', 'undefined'].includes(text.toLowerCase())) return null;
  return text;
}

// Hash determinístico (cyrb53) para ids estables sin depender de módulos de Node.
function hash(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

// Divide un texto en fragmentos de hasta `size` caracteres, cortando preferentemente
// en párrafo, salto de línea, fin de oración o espacio, con `overlap` de solapamiento.
function chunkText(text, size, overlap) {
  if (text.length <= size) return [text];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const window = text.slice(start, end);
      const cut = Math.max(
        window.lastIndexOf('\n\n'),
        window.lastIndexOf('\n'),
        window.lastIndexOf('. '),
        window.lastIndexOf(' ')
      );
      if (cut > size * 0.5) end = start + cut + 1;
    }
    chunks.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    // El solapamiento arranca en el próximo espacio para no cortar palabras.
    let next = Math.max(end - overlap, start + 1);
    const space = text.indexOf(' ', next);
    if (space !== -1 && space < end) next = space + 1;
    start = next;
  }
  return chunks.filter(Boolean);
}

// ───────────────────────── Proceso ─────────────────────────

const exclude = new Set(CONFIG.EXCLUDE_COLUMNS.map(normalizeKey));
const textCols = CONFIG.TEXT_COLUMNS && CONFIG.TEXT_COLUMNS.map(normalizeKey);
const metaCols = CONFIG.METADATA_COLUMNS && CONFIG.METADATA_COLUMNS.map(normalizeKey);
const idCol = CONFIG.ID_COLUMN && normalizeKey(CONFIG.ID_COLUMN);

const output = [];
const seen = new Set();

for (const [index, item] of $input.all().entries()) {
  const raw = item.json || {};

  // 1. Normalizar claves y limpiar valores. Se conserva el nombre original para el texto.
  const row = {};
  const labels = {};
  for (const [key, value] of Object.entries(raw)) {
    const k = normalizeKey(key);
    if (!k) continue;
    row[k] = cleanValue(value);
    labels[k] = String(key).trim();
  }

  // 2. Armar el texto "Columna: valor" con las columnas elegidas.
  const cols = textCols || Object.keys(row).filter((k) => !exclude.has(k));
  const lines = cols
    .filter((k) => row[k] !== null && row[k] !== undefined)
    .map((k) => `${labels[k] || k}: ${row[k]}`);
  const text = lines.join('\n');

  // 3. Saltar filas vacías o duplicadas.
  if (text.replace(/\s/g, '').length < CONFIG.MIN_TEXT_LENGTH) continue;
  const contentHash = hash(text);
  if (seen.has(contentHash)) continue;
  seen.add(contentHash);

  // 4. Metadatos (solo valores primitivos, que es lo que aceptan la mayoría de las bases vectoriales).
  const rowNumber = raw.row_number ?? index + 2; // fila 1 = encabezados
  const rowId = String((idCol && row[idCol]) ?? rowNumber);
  const metadata = { source: CONFIG.SOURCE, row_id: rowId, row_number: rowNumber, content_hash: contentHash };
  for (const k of metaCols || []) {
    if (row[k] !== null && row[k] !== undefined) metadata[k] = row[k];
  }

  // 5. Fragmentar y emitir un item por fragmento.
  const chunks = chunkText(text, CONFIG.CHUNK_SIZE, CONFIG.CHUNK_OVERLAP);
  chunks.forEach((chunk, i) => {
    output.push({
      json: {
        id: `${rowId}-${i}`,
        pageContent: chunk,
        metadata: { ...metadata, chunk_index: i, chunk_total: chunks.length },
      },
    });
  });
}

return output;
