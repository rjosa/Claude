# Google Sheets → Base de datos vectorial (n8n)

`gsheet-to-vector.js` es el código para un nodo **Code** de n8n que toma las filas de un
nodo **Google Sheets** y las deja listas para cargarlas en un Vector Store.

## Flujo

```
Google Sheets (Get Rows) → Code (gsheet-to-vector.js) → Vector Store (Insert)
                                                          ├─ Embeddings (OpenAI, etc.)
                                                          └─ Default Data Loader
```

1. Nodo **Code**: modo *Run Once for All Items*, lenguaje JavaScript, pegar el contenido de `gsheet-to-vector.js`.
2. Ajustar el bloque `CONFIG` (columnas de texto, de metadatos, columna id, tamaño de fragmento).
3. En el **Default Data Loader**: *Type of Data* = JSON, *Mode* = *Load Specific Data*,
   *Data* = `{{ $json.pageContent }}`, y en *Options → Metadata* agregar los campos que quieras
   (por ejemplo `row_id` = `{{ $json.metadata.row_id }}`).

## Qué hace

- Normaliza los nombres de columna (`"Fecha de Alta"` → `fecha_de_alta`) y limpia los valores
  (espacios, saltos de línea, `N/A`, `-`, vacíos).
- Arma el texto de cada fila como `Columna: valor` por línea, que da mejores embeddings que el JSON crudo.
- Descarta filas vacías y duplicadas (por hash del contenido).
- Divide textos largos en fragmentos con solapamiento, cortando en párrafos/oraciones/palabras.
- Genera un `id` estable por fragmento (`<row_id>-<n>`) para poder hacer upsert sin duplicar.

## Salida

```json
{
  "id": "P-002-0",
  "pageContent": "Título: Envíos\nCategoría: Logística\nDescripción: Envíos a todo el país en 48 a 72 hs.",
  "metadata": { "source": "google_sheets", "row_id": "P-002", "row_number": 3,
                "content_hash": "12d43da8c7be2b", "categoria": "Logística",
                "chunk_index": 0, "chunk_total": 1 }
}
```

## Prueba local

```bash
node n8n/test-gsheet-to-vector.js
```
