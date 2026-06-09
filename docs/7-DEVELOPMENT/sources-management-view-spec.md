# Especificación funcional: Vista de gestión de fuentes (Open Notebook API)

**Versión:** 1.0  
**Destinatario:** equipo de desarrollo del proyecto externo (Java + Angular)  
**Propósito:** construir una vista que permita listar, subir y reemplazar fuentes en
Open Notebook a través de su API REST. Este documento es autocontenido: no se
necesita acceso al repositorio de Open Notebook.

---

## 1. Alcance

| Funcionalidad | Incluida |
|---|:---:|
| Listar todas las fuentes de un cuaderno (con su ID) | ✅ |
| Subir una fuente nueva (archivo PDF u otro documento) | ✅ |
| Reemplazar el contenido de una fuente existente con un archivo nuevo | ✅ |
| Ver estado del procesamiento (polling) | ✅ |
| Editar título / categorías de una fuente | ❌ |
| Eliminar fuentes | ❌ |
| Re-procesar el mismo archivo/URL sin cambiar contenido | ❌ |

---

## 2. Autenticación

Todas las llamadas requieren el header:

```
Authorization: Bearer <OPEN_NOTEBOOK_PASSWORD>
```

- La contraseña la configura el administrador de Open Notebook con la variable de
  entorno `OPEN_NOTEBOOK_PASSWORD`.
- Si se omite o es incorrecta, el servidor devuelve `401 Unauthorized`.

### Base URL

| Contexto | URL |
|---|---|
| Desarrollo local | `http://localhost:5055` |
| Desde otro contenedor en el mismo Docker Compose | `http://open_notebook:5055` |
| Producción | configurar según el entorno |

Todos los endpoints tienen el prefijo `/api`. Ejemplo completo:
`http://localhost:5055/api/notebooks`

---

## 3. Contrato de API

### 3.1 Listar cuadernos

Necesario para poblar el selector de cuaderno destino al subir una fuente nueva.

**Request**

```
GET /api/notebooks
Authorization: Bearer <password>
```

Query params opcionales: `archived=false` (bool), `order_by=updated` (string).

**Response 200**

Array de objetos:

```jsonc
[
  {
    "id":           "notebook:abc123",   // ← usar este valor en el campo notebooks al subir
    "name":         "frentes",
    "description":  "Cuaderno sobre frentes comerciales",
    "archived":     false,
    "created":      "2025-01-15T10:00:00Z",
    "updated":      "2025-06-05T14:22:00Z",
    "source_count": 4,
    "note_count":   7
  }
]
```

---

### 3.2 Listar fuentes

La tabla principal de la vista. De aquí se obtienen los **IDs** (`source:xxx`)
necesarios para la acción de reemplazo.

**Request**

```
GET /api/sources?notebook_id=notebook:abc123&limit=50&offset=0&sort_by=updated&sort_order=desc
Authorization: Bearer <password>
```

| Parámetro | Tipo | Default | Descripción |
|---|---|---|---|
| `notebook_id` | string | — | Si se omite, lista fuentes de todos los cuadernos |
| `limit` | int | 50 | Máx. registros (rango 1–100) |
| `offset` | int | 0 | Paginación |
| `sort_by` | string | `updated` | `created` o `updated` |
| `sort_order` | string | `desc` | `asc` o `desc` |

**Response 200**

Array de objetos:

```jsonc
[
  {
    "id":              "source:zxcvbn",   // ← ID que se usa en PUT /sources/{id}/content
    "title":           "Informe Q1 2025",
    "topics":          ["finanzas", "trimestral"],
    "asset": {
      "file_path":     "/app/data/uploads/informe_q1.pdf",  // null si es tipo link o text
      "url":           null                                  // null si es tipo upload
    },
    "embedded":        true,        // true = tiene embeddings para búsqueda semántica
    "embedded_chunks": 38,          // número de fragmentos vectorizados
    "insights_count":  2,
    "created":         "2025-05-10T09:00:00Z",
    "updated":         "2025-06-01T11:30:00Z",
    "file_available":  true,        // el archivo físico existe en el servidor
    "command_id":      null,        // ID del job de procesamiento (si hay uno activo)
    "status":          "completed", // ver sección 3.5
    "processing_info": null
  }
]
```

**Campos clave para la vista**

| Campo | Uso en la UI |
|---|---|
| `id` | Identificador único — mostrar y usar en el `PUT` |
| `title` | Nombre de la fuente |
| `embedded` + `embedded_chunks` | Indicador "listo para búsqueda" |
| `status` | Estado de procesamiento |
| `asset.url` | Mostrar si es fuente de tipo web |
| `asset.file_path` | Indica que es tipo archivo |

---

### 3.3 Subir una fuente nueva

**Request — multipart/form-data (recomendado para archivos)**

```
POST /api/sources
Authorization: Bearer <password>
Content-Type: multipart/form-data

Campos:
  file              → binario del archivo (PDF, DOCX, etc.)
  type              → "upload"
  notebooks         → JSON string: ["notebook:abc123"]   // lista de cuaderno(s) destino
  embed             → "true"                             // generar embeddings (recomendado)
  title             → "Informe Q2 2025"                  // opcional
  async_processing  → "false"                            // ver nota abajo
```

> **Nota `async_processing`:**  
> - `false` (default) → espera hasta que el procesamiento termine y devuelve la
>   fuente con `full_text` y `embedded_chunks` ya completados (puede tardar segundos
>   o minutos según el tamaño del archivo).  
> - `true` → devuelve inmediatamente con `status="queued"` y un `command_id` para
>   hacer polling (ver sección 3.5).

**Request alternativo — JSON (para URLs o texto plano)**

```
POST /api/sources/json
Authorization: Bearer <password>
Content-Type: application/json

// Fuente de tipo web (URL):
{
  "type":             "link",
  "url":              "https://ejemplo.com/articulo",
  "notebooks":        ["notebook:abc123"],
  "embed":            true,
  "title":            "Artículo de referencia",
  "async_processing": false
}

// Fuente de tipo texto plano:
{
  "type":             "text",
  "content":          "El contenido completo de la fuente va aquí...",
  "notebooks":        ["notebook:abc123"],
  "embed":            true
}
```

**Response 200** (procesamiento síncrono):

```jsonc
{
  "id":              "source:newid1",
  "title":           "Informe Q2 2025",
  "topics":          [],
  "asset":           { "file_path": "/app/data/uploads/informe_q2.pdf", "url": null },
  "full_text":       "Contenido extraído del PDF...",
  "embedded":        true,
  "embedded_chunks": 42,
  "file_available":  true,
  "created":         "2025-06-07T15:00:00Z",
  "updated":         "2025-06-07T15:00:00Z",
  "command_id":      null,
  "status":          null,
  "processing_info": null,
  "notebooks":       ["notebook:abc123"]
}
```

**Response 200** (procesamiento asíncrono — `async_processing=true`):

```jsonc
{
  "id":              "source:newid1",
  "title":           "Informe Q2 2025",
  "full_text":       null,
  "embedded":        false,
  "embedded_chunks": 0,
  "command_id":      "command:xyz789",
  "status":          "queued",
  "processing_info": { "async": true, "queued": true }
}
```

Continuar con polling a `GET /api/sources/{id}/status` hasta que `status` sea
`"completed"` o `"failed"`.

---

### 3.4 Reemplazar el contenido de una fuente existente

Este es el endpoint central de la funcionalidad de "actualizar fuente". El **ID de
la fuente se conserva**, por lo que todos los cuadernos que la referencian ven el
nuevo contenido automáticamente y los embeddings de búsqueda semántica se regeneran
sin necesidad de re-vincular nada.

**Request — multipart/form-data (para subir un archivo nuevo)**

```
PUT /api/sources/{source_id}/content
Authorization: Bearer <password>
Content-Type: multipart/form-data

Path param:
  source_id         → el ID de la fuente a reemplazar, ej. "source:zxcvbn"

Campos:
  file              → binario del archivo nuevo (el anterior se elimina del servidor)
  type              → "upload"
  embed             → "true"      // re-generar embeddings (default true, recomendado)
  title             → "Informe Q1 revisado"   // opcional; si se omite, conserva el título actual
  async_processing  → "false"
```

> **Garantía clave:** el `id` de la fuente **no cambia**. Los cuadernos vinculados
> a ella (mediante la arista `reference` en la base de datos) siguen apuntando a la
> misma fuente y ven el nuevo contenido automáticamente en la próxima consulta.

**Request alternativo — JSON (para cambiar la URL o el texto plano)**

```
PUT /api/sources/{source_id}/content/json
Authorization: Bearer <password>
Content-Type: application/json

// Cambiar a una nueva URL:
{
  "type":  "link",
  "url":   "https://ejemplo.com/nueva-pagina",
  "embed": true
}

// Cambiar a texto plano nuevo:
{
  "type":    "text",
  "content": "Contenido actualizado que reemplaza al anterior.",
  "embed":   true
}
```

**Response 200** (procesamiento síncrono):

```jsonc
{
  "id":              "source:zxcvbn",   // ← mismo ID que antes del reemplazo
  "title":           "Informe Q1 revisado",
  "asset":           { "file_path": "/app/data/uploads/informe_q1_v2.pdf", "url": null },
  "full_text":       "Contenido extraído del PDF nuevo...",
  "embedded":        true,
  "embedded_chunks": 45,
  "created":         "2025-05-10T09:00:00Z",
  "updated":         "2025-06-07T16:00:00Z",
  "command_id":      null,
  "status":          null
}
```

**Response 200** (asíncrono — `async_processing=true`):

```jsonc
{
  "id":              "source:zxcvbn",
  "full_text":       null,
  "embedded":        false,
  "embedded_chunks": 0,
  "command_id":      "command:abc456",
  "status":          "queued",
  "processing_info": { "replace": true, "queued": true }
}
```

---

### 3.5 Consultar estado de procesamiento

Usar cuando `async_processing=true` en la subida o el reemplazo.

**Request**

```
GET /api/sources/{source_id}/status
Authorization: Bearer <password>
```

**Response 200**

```jsonc
{
  "status":          "running",   // new | queued | running | completed | failed
  "message":         "Processing source content...",
  "command_id":      "command:abc456",
  "processing_info": {
    "started_at":    "2025-06-07T16:00:05Z",
    "completed_at":  null,
    "error":         null
  }
}
```

| Valor de `status` | Significado |
|---|---|
| `new` | Creada, todavía no en cola |
| `queued` | En cola, esperando worker |
| `running` | Procesándose activamente |
| `completed` | Listo — `full_text` y embeddings disponibles |
| `failed` | Error — ver `processing_info.error` |

**Estrategia de polling recomendada:** intervalo de 3–5 segundos, timeout de 5
minutos.

---

### 3.6 Errores comunes

| HTTP | Causa | Mensaje típico |
|---|---|---|
| `401` | Header de auth ausente o contraseña incorrecta | `"Invalid password"` |
| `400` | Falta campo requerido (`url`, `content` o archivo) | `"URL is required for link type"` |
| `400` | Fuente ya está procesándose (job activo) | `"Source is already processing..."` |
| `404` | `source_id` o `notebook_id` no existe | `"Source not found"` |
| `500` | Error interno de procesamiento | detalle en `"detail"` |

Formato de error:

```json
{ "detail": "mensaje descriptivo del error" }
```

---

## 4. Comportamiento de la vista (requisitos funcionales)

### 4.1 Tabla de fuentes

- Al cargar la vista, primero llamar a `GET /api/notebooks` para poblar el filtro de
  cuadernos.
- Llamar a `GET /api/sources` (con o sin `notebook_id`) y mostrar la tabla.
- **Columnas mínimas:** ID de fuente, Título, Origen (URL o archivo), Estado,
  Chunks embebidos, Última actualización.
- El **ID de fuente** debe ser visible en la tabla (es lo que el usuario necesita
  para el reemplazo y para referencias externas, p.ej. en n8n).
- Si `embedded=true`, mostrar indicador visual "Listo para búsqueda".
- Si `status` es `queued` o `running`, mostrar indicador de procesamiento y hacer
  polling automático hasta que cambie a `completed` o `failed`.

### 4.2 Acción "Subir fuente nueva"

- Botón o formulario flotante con:
  - Selector de archivo (campo `file`).
  - Selector de cuaderno(s) destino (multi-select poblado con los datos de
    `GET /api/notebooks`).
  - Campo opcional de título.
  - Opción de procesamiento asíncrono (toggle).
- Al confirmar: `POST /api/sources` multipart.
- Si la respuesta tiene `status="queued"` → iniciar polling con el `command_id`.
- Al completarse, recargar la tabla de fuentes.

### 4.3 Acción "Reemplazar contenido" (por fila)

- Botón en cada fila de la tabla (puede ser ícono de "reemplazar" o "actualizar").
- Al hacer clic, abrir un selector de archivo.
- Al confirmar: `PUT /api/sources/{id}/content` multipart con el `id` de esa fila
  y el archivo nuevo.
- Si la respuesta tiene `status="queued"` → iniciar polling con el `command_id`.
- Al completarse, actualizar esa fila en la tabla (refrescar `GET /api/sources/{id}`
  o recargar toda la lista).
- **No** hay que especificar cuadernos: los vínculos existentes se conservan
  automáticamente.

### 4.4 Feedback al usuario

- Durante el procesamiento síncrono: mostrar spinner/loading en el formulario.
- Durante el procesamiento asíncrono: mostrar badge "Procesando..." en la fila
  correspondiente; actualizar cuando el polling retorne `completed` o `failed`.
- En caso de error (`status=failed` o HTTP 4xx/5xx): mostrar mensaje descriptivo
  (`response.detail` o `processing_info.error`).
- En caso de éxito: notificación breve + refresco de la tabla.

---

## 5. Flujo end-to-end

```
[Inicio]
  │
  ├─► GET /api/notebooks          → poblar selector de cuadernos
  │
  ├─► GET /api/sources?notebook_id=...  → mostrar tabla con IDs y estados
  │
  ├─── [Usuario quiere subir fuente nueva]
  │      │
  │      ├─► POST /api/sources   (multipart con archivo + notebook destino)
  │      │     sync  → fuente lista → refrescar tabla
  │      │     async → status="queued" → polling GET /sources/{id}/status → completado → refrescar
  │
  └─── [Usuario quiere reemplazar una fuente]
         │
         ├─► Selecciona fila → obtiene source_id de la tabla
         │
         ├─► PUT /api/sources/{source_id}/content  (multipart con archivo nuevo)
         │     sync  → fuente actualizada → refrescar fila
         │     async → status="queued" → polling GET /sources/{id}/status → completado → refrescar
         │
         └─► [Todos los cuadernos que referencian esa fuente ven el contenido nuevo]
```

---

## 6. Notas de integración y despliegue

- **CORS:** Open Notebook permite todos los orígenes en desarrollo (`Access-Control-Allow-Origin: *`). No se necesita configuración adicional en el frontend Angular.
- **Tamaño de archivos:** no hay límite definido en la API, pero el procesamiento síncrono puede tardar varios minutos para documentos grandes. Usar `async_processing=true` para archivos de más de ~5 MB.
- **Tipos de archivo soportados:** PDF, DOCX, TXT, HTML, Markdown, imágenes, audio,
  video y más de 50 formatos adicionales (procesados por la librería `content-core`).
- **Seguridad:** la API solo acepta archivos subidos dentro de la carpeta de uploads del servidor. No exponer el campo `file_path` del servidor al usuario final.
- **Paginación:** usar `limit` y `offset` en `GET /api/sources` si el volumen de fuentes es grande (default 50 por página, máximo 100).

---

## 7. Endpoints de referencia rápida

| Acción | Método | URL |
|---|---|---|
| Listar cuadernos | `GET` | `/api/notebooks` |
| Listar fuentes | `GET` | `/api/sources?notebook_id=notebook:xxx` |
| Detalle de fuente | `GET` | `/api/sources/{source_id}` |
| Subir fuente (archivo) | `POST` | `/api/sources` |
| Subir fuente (URL/texto) | `POST` | `/api/sources/json` |
| **Reemplazar contenido (archivo)** | **`PUT`** | **`/api/sources/{source_id}/content`** |
| **Reemplazar contenido (URL/texto)** | **`PUT`** | **`/api/sources/{source_id}/content/json`** |
| Ver estado de procesamiento | `GET` | `/api/sources/{source_id}/status` |
