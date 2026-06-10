from fastapi import APIRouter, HTTPException
from loguru import logger

from api.models import ContextConfig, ContextRequest, ContextResponse
from open_notebook.domain.notebook import Note, Notebook, Source
from open_notebook.exceptions import InvalidInputError
from open_notebook.utils import token_count

router = APIRouter()


@router.post("/notebooks/{notebook_id}/context", response_model=ContextResponse)
async def get_notebook_context(notebook_id: str, context_request: ContextRequest):
    """Get context for a notebook based on configuration."""
    try:
        # Verify notebook exists
        notebook = await Notebook.get(notebook_id)
        if not notebook:
            raise HTTPException(status_code=404, detail="Notebook not found")

        # Load persisted context_config — "not in" is authoritative
        saved_cfg = notebook.context_config or {}
        saved_sources: dict[str, str] = {
            str(k): str(v) for k, v in saved_cfg.get("sources", {}).items()
        }
        saved_notes: dict[str, str] = {
            str(k): str(v) for k, v in saved_cfg.get("notes", {}).items()
        }

        context_data: dict[str, list[dict[str, str]]] = {"note": [], "source": []}
        total_content = ""

        # Process context configuration if provided
        if context_request.context_config:
            # Process sources
            for source_id, status in context_request.context_config.sources.items():
                full_source_id = (
                    source_id
                    if source_id.startswith("source:")
                    else f"source:{source_id}"
                )
                saved_status = saved_sources.get(full_source_id, "")
                if "not in" in saved_status or "not in" in status:
                    continue

                try:
                    try:
                        source = await Source.get(full_source_id)
                    except Exception:
                        continue

                    if "insights" in status:
                        source_context = await source.get_context(context_size="short")
                        context_data["source"].append(source_context)
                        total_content += str(source_context)
                    elif "full content" in status:
                        source_context = await source.get_context(context_size="long")
                        context_data["source"].append(source_context)
                        total_content += str(source_context)
                except Exception as e:
                    logger.warning(f"Error processing source {source_id}: {str(e)}")
                    continue

            # Process notes
            for note_id, status in context_request.context_config.notes.items():
                full_note_id = (
                    note_id if note_id.startswith("note:") else f"note:{note_id}"
                )
                saved_status = saved_notes.get(full_note_id, "")
                if "not in" in saved_status or "not in" in status:
                    continue

                try:
                    note = await Note.get(full_note_id)
                    if not note:
                        continue

                    if "full content" in status:
                        note_context = note.get_context(context_size="long")
                        context_data["note"].append(note_context)
                        total_content += str(note_context)
                except Exception as e:
                    logger.warning(f"Error processing note {note_id}: {str(e)}")
                    continue
        else:
            # No frontend config — use saved config; fall back to all sources/notes
            sources = await notebook.get_sources()
            for source in sources:
                try:
                    src_id = str(source.id)
                    saved_status = saved_sources.get(src_id, "insights")
                    if "not in" in saved_status:
                        continue
                    size = "long" if "full content" in saved_status else "short"
                    source_context = await source.get_context(context_size=size)
                    context_data["source"].append(source_context)
                    total_content += str(source_context)
                except Exception as e:
                    logger.warning(f"Error processing source {source.id}: {str(e)}")
                    continue

            notes = await notebook.get_notes()
            for note in notes:
                try:
                    note_id = str(note.id)
                    saved_status = saved_notes.get(note_id, "full content")
                    if "not in" in saved_status:
                        continue
                    size = "long" if "full content" in saved_status else "short"
                    note_context = note.get_context(context_size=size)
                    context_data["note"].append(note_context)
                    total_content += str(note_context)
                except Exception as e:
                    logger.warning(f"Error processing note {note.id}: {str(e)}")
                    continue

        # Calculate estimated token count
        estimated_tokens = token_count(total_content) if total_content else 0

        return ContextResponse(
            notebook_id=notebook_id,
            sources=context_data["source"],
            notes=context_data["note"],
            total_tokens=estimated_tokens,
        )

    except HTTPException:
        raise
    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting context for notebook {notebook_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error getting context: {str(e)}")


@router.put("/notebooks/{notebook_id}/context-config", status_code=204)
async def save_notebook_context_config(notebook_id: str, context_config: ContextConfig):
    """Persist the context configuration for a notebook."""
    try:
        notebook = await Notebook.get(notebook_id)
        if not notebook:
            raise HTTPException(status_code=404, detail="Notebook not found")

        notebook.context_config = {
            "sources": context_config.sources,
            "notes": context_config.notes,
        }
        await notebook.save()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error saving context config for notebook {notebook_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error saving context config: {str(e)}")
