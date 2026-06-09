# Integración externa de fuentes (REST API)

Guía para gestionar fuentes de Open Notebook desde un servicio externo (n8n,
scripts, pipelines de datos, etc.) usando la API REST.

---

## Autenticación

Todas las llamadas requieren el header:

```
Authorization: Bearer <OPEN_NOTEBOOK_PASSWORD>
```

La contraseña se configura con la variable de entorno `OPEN_NOTEBOOK_PASSWORD`
(por defecto `open-notebook-change-me` en desarrollo).

> **Docker Compose:** Si tu servicio externo corre en otro contenedor del mismo
> `docker-compose.yml`, usa el nombre del servicio como hostname en lugar de
> `localhost`:
> ```
> http://open_notebook:5055/api/...
> ```

---

## Tabla de endpoints disponibles

| Acción | Método | Endpoint |
|---|---|---|
| Listar cuadernos | GET | `/api/notebooks` |
| Listar fuentes de un cuaderno | GET | `/api/sources?notebook_id=notebook:xxx` |
| Obtener una fuente | GET | `/api/sources/{id}` |
| Crear fuente (multipart/JSON) | POST | `/api/sources` |
| Crear fuente (solo JSON) | POST | `/api/sources/json` |
| Actualizar metadatos (título/topics) | PUT | `/api/sources/{id}` |
| **Reemplazar contenido (multipart)** | **PUT** | **`/api/sources/{id}/content`** |
| **Reemplazar contenido (solo JSON)** | **PUT** | **`/api/sources/{id}/content/json`** |
| Re-procesar el mismo origen | POST | `/api/sources/{id}/retry` |
| Ver estado de procesamiento | GET | `/api/sources/{id}/status` |
| Eliminar fuente | DELETE | `/api/sources/{id}` |

---

## 1. Obtener los IDs de cuadernos

Antes de crear o consultar fuentes necesitás el ID real de los cuadernos
(formato `notebook:xxxx`).

```bash
curl -s http://localhost:5055/api/notebooks \
  -H "Authorization: Bearer tu_password" | jq '.[].id, .[].name'
```

Respuesta de ejemplo:
```json
"notebook:abc123"
"frentes"
"notebook:def456"
"tersitech"
```

---

## 2. Listar fuentes de un cuaderno

```bash
curl -s "http://localhost:5055/api/sources?notebook_id=notebook:abc123&limit=50" \
  -H "Authorization: Bearer tu_password"
```

Campos clave de cada fuente en la respuesta:

| Campo | Descripción |
|---|---|
| `id` | ID de la fuente (`source:xxxx`) — necesario para actualizarla |
| `title` | Título |
| `embedded` | `true` si ya tiene embeddings para búsqueda semántica |
| `embedded_chunks` | Número de fragmentos embebidos |
| `status` | Estado del job: `new`, `queued`, `running`, `completed`, `failed` |
| `asset.url` | URL de origen (fuentes de tipo link) |
| `asset.file_path` | Ruta del archivo (fuentes de tipo upload) |

---

## 3. Crear una fuente nueva

### Desde una URL

```bash
curl -s -X POST http://localhost:5055/api/sources/json \
  -H "Authorization: Bearer tu_password" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "link",
    "url": "https://ejemplo.com/articulo",
    "notebooks": ["notebook:abc123"],
    "embed": true
  }'
```

### Desde texto plano

```bash
curl -s -X POST http://localhost:5055/api/sources/json \
  -H "Authorization: Bearer tu_password" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "text",
    "content": "El contenido de la fuente va aquí...",
    "title": "Resumen de reunión",
    "notebooks": ["notebook:abc123", "notebook:def456"],
    "embed": true
  }'
```

### Desde un archivo PDF (multipart)

```bash
curl -s -X POST http://localhost:5055/api/sources \
  -H "Authorization: Bearer tu_password" \
  -F "file=@/ruta/al/archivo.pdf" \
  -F "type=upload" \
  -F 'notebooks=["notebook:abc123"]' \
  -F "embed=true" \
  -F "title=Informe Q1"
```

La respuesta incluye el `id` de la fuente creada:
```json
{
  "id": "source:zxcvbn",
  "title": "Informe Q1",
  "status": "new",
  ...
}
```

#### Procesamiento asíncrono

Para archivos grandes, usá `async_processing=true`. La respuesta devuelve
inmediatamente con un `command_id` para hacer polling:

```bash
curl -s -X POST http://localhost:5055/api/sources \
  -H "Authorization: Bearer tu_password" \
  -F "file=@/ruta/al/archivo.pdf" \
  -F "type=upload" \
  -F 'notebooks=["notebook:abc123"]' \
  -F "embed=true" \
  -F "async_processing=true"
```

---

## 4. Reemplazar el contenido de una fuente existente ⭐

Este es el caso de uso principal: tenés una fuente creada desde un PDF y querés
**pisar ese PDF con uno nuevo**, sin perder los vínculos a los cuadernos.

### ¿Por qué funciona?

- El **mismo `source_id`** se conserva.
- Los cuadernos vinculan fuentes por arista de grafo (`reference`), no por copia
  de datos. Al mantener el `id`, todos los cuadernos ven el contenido nuevo
  automáticamente en la próxima consulta.
- El job `embed_source` borra los chunks de embeddings viejos antes de
  re-insertar los nuevos, así la búsqueda semántica se actualiza para todos los
  cuadernos sin intervención manual.

### Reemplazar con un nuevo PDF (multipart)

```bash
curl -s -X PUT http://localhost:5055/api/sources/source:zxcvbn/content \
  -H "Authorization: Bearer tu_password" \
  -F "file=@/ruta/al/nuevo_archivo.pdf" \
  -F "type=upload" \
  -F "embed=true"
```

Respuesta (procesamiento síncrono):
```json
{
  "id": "source:zxcvbn",
  "title": "Informe Q1",
  "full_text": "... contenido del PDF nuevo ...",
  "embedded": true,
  "embedded_chunks": 42,
  "status": null
}
```

### Reemplazar con una nueva URL (JSON)

```bash
curl -s -X PUT http://localhost:5055/api/sources/source:zxcvbn/content/json \
  -H "Authorization: Bearer tu_password" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "link",
    "url": "https://ejemplo.com/nueva-pagina",
    "embed": true
  }'
```

### Reemplazar con texto nuevo (JSON)

```bash
curl -s -X PUT http://localhost:5055/api/sources/source:zxcvbn/content/json \
  -H "Authorization: Bearer tu_password" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "text",
    "content": "Nuevo contenido que reemplaza al anterior.",
    "title": "Resumen actualizado",
    "embed": true
  }'
```

### Campos del request de reemplazo

| Campo | Tipo | Descripción |
|---|---|---|
| `type` | string (req.) | `link`, `upload`, o `text` |
| `url` | string | URL de la fuente (requerido si `type=link`) |
| `content` | string | Texto plano (requerido si `type=text`) |
| `file_path` | string | Ruta de archivo ya subido al servidor (alternativa al multipart) |
| `title` | string | Nuevo título. Si se omite, se conserva el título existente |
| `embed` | bool | Re-generar embeddings para búsqueda semántica (default: `true`) |
| `async_processing` | bool | Procesar en segundo plano y devolver `command_id` (default: `false`) |
| `transformations` | list[string] | IDs de transformaciones a aplicar tras la extracción |

> **Nota:** no existe campo `notebooks` en este request. Los vínculos a cuadernos
> se conservan automáticamente al mantener el mismo `source_id`.

---

## 5. Re-procesar el mismo origen (sin cambiar URL/archivo)

Útil cuando la página web o el archivo externo cambió en origen pero querés
conservar la misma URL registrada:

```bash
curl -s -X POST http://localhost:5055/api/sources/source:zxcvbn/retry \
  -H "Authorization: Bearer tu_password"
```

Diferencia con `PUT /content`: `retry` re-descarga el **mismo** asset (misma URL
o archivo). `PUT /content` permite apuntar a un **recurso diferente**.

---

## 6. Hacer polling del estado de procesamiento

Cuando usás `async_processing=true`, la respuesta incluye un `command_id`.
Polleá el estado con:

```bash
curl -s http://localhost:5055/api/sources/source:zxcvbn/status \
  -H "Authorization: Bearer tu_password"
```

Posibles valores de `status`: `new`, `queued`, `running`, `completed`, `failed`.

Ejemplo de loop de polling en bash:
```bash
SOURCE_ID="source:zxcvbn"
PASSWORD="tu_password"

while true; do
  STATUS=$(curl -s "http://localhost:5055/api/sources/$SOURCE_ID/status" \
    -H "Authorization: Bearer $PASSWORD" | jq -r '.status')
  echo "Estado: $STATUS"
  [[ "$STATUS" == "completed" || "$STATUS" == "failed" ]] && break
  sleep 5
done
```

---

## 7. Eliminar una fuente

```bash
curl -s -X DELETE http://localhost:5055/api/sources/source:zxcvbn \
  -H "Authorization: Bearer tu_password"
```

Esto elimina la fuente, el archivo en disco (si aplica), todos sus embeddings e
insights. Los cuadernos que la referenciaban dejan de verla automáticamente.

---

## Cuándo usar cada endpoint — resumen

| Situación | Endpoint |
|---|---|
| Agregar contenido nuevo a un cuaderno | `POST /api/sources` o `/api/sources/json` |
| Cambiar solo el título o los topics | `PUT /api/sources/{id}` |
| Pisar un PDF/URL/texto con contenido nuevo | **`PUT /api/sources/{id}/content`** |
| Re-descargar la misma URL (el sitio cambió) | `POST /api/sources/{id}/retry` |
| Ver si el procesamiento terminó | `GET /api/sources/{id}/status` |
| Quitar una fuente de todos los cuadernos | `DELETE /api/sources/{id}` |

---

## Referencia adicional

- [API Reference general](api-reference.md)
- [Swagger UI interactivo](http://localhost:5055/docs) — prueba los endpoints
  directamente con el formulario web
- [Guía de chat/ask para consultas desde n8n](api-reference.md)
