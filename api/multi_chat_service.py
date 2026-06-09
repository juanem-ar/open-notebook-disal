"""
Multi-notebook chat service.

Centralises the logic shared by:
- POST /chat/multi/execute  (rich UI response with full message list)
- POST /chat/ask            (flat response for n8n / Teams integration)
"""

import asyncio
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from langchain_core.messages import HumanMessage
from langchain_core.runnables import RunnableConfig
from loguru import logger

from open_notebook.domain.notebook import ChatSession, Notebook
from open_notebook.graphs.chat import graph as chat_graph


# ---------------------------------------------------------------------------
# Context assembly
# ---------------------------------------------------------------------------

async def build_multi_notebook_context(
    notebook_ids: List[str],
) -> Dict[str, Any]:
    """
    Collect sources and notes from every notebook in *notebook_ids* and merge
    them into a single context dict ``{"sources": [...], "notes": [...]}``.

    Returns also ``token_count`` and ``char_count`` estimates.
    """
    context_data: Dict[str, list] = {"sources": [], "notes": []}
    total_content = ""

    for notebook_id in notebook_ids:
        try:
            notebook = await Notebook.get(notebook_id)
            if not notebook:
                logger.warning(f"Notebook {notebook_id} not found, skipping")
                continue
        except Exception as exc:
            logger.warning(f"Could not load notebook {notebook_id}: {exc}")
            continue

        # Sources
        try:
            sources = await notebook.get_sources()
        except Exception as exc:
            logger.warning(f"Could not load sources for {notebook_id}: {exc}")
            sources = []

        for source in sources:
            try:
                src_ctx = await source.get_context(context_size="short")
                context_data["sources"].append(src_ctx)
                total_content += str(src_ctx)
            except Exception as exc:
                logger.warning(f"Error processing source {source.id}: {exc}")

        # Notes
        try:
            notes = await notebook.get_notes()
        except Exception as exc:
            logger.warning(f"Could not load notes for {notebook_id}: {exc}")
            notes = []

        for note in notes:
            try:
                note_ctx = note.get_context(context_size="short")
                context_data["notes"].append(note_ctx)
                total_content += str(note_ctx)
            except Exception as exc:
                logger.warning(f"Error processing note {note.id}: {exc}")

    char_count = len(total_content)
    try:
        from open_notebook.utils import token_count as _token_count

        estimated_tokens = _token_count(total_content) if total_content else 0
    except Exception:
        estimated_tokens = char_count // 4

    return {
        "context": context_data,
        "token_count": estimated_tokens,
        "char_count": char_count,
    }


# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------

async def get_or_create_session(
    session_id: str,
    notebook_ids: Optional[List[str]] = None,
    model_override: Optional[str] = None,
) -> ChatSession:
    """
    Return the existing ChatSession whose ``id`` matches *session_id* (after
    normalising the table prefix), or create a brand-new one.

    When creating, ``notebook_ids`` and ``model_override`` are stored on the
    record so subsequent calls can omit them.
    """
    # Normalize to a bare SurrealDB identifier (only alphanumeric + underscore).
    # Hyphens and other special chars in the ID part cause SurrealDB parse errors
    # and the Python driver's str(RecordID) wraps them in ⟨⟩, which then gets
    # double-escaped on every subsequent save.
    raw_id = session_id[len("chat_session:"):] if session_id.startswith("chat_session:") else session_id
    safe_id = re.sub(r"[^a-zA-Z0-9_]", "_", raw_id)
    full_id = f"chat_session:{safe_id}"

    session: Optional[ChatSession] = None
    try:
        session = await ChatSession.get(full_id)
    except Exception:
        pass

    if session is None:
        title = f"Multi-chat {session_id[:20]}"
        session = ChatSession(
            id=full_id,
            title=title,
            model_override=model_override,
            notebook_ids=notebook_ids,
            created=datetime.now(),
        )
        await session.save()
        logger.info(f"Created new multi-chat session {session.id}")
    else:
        # Persist any new notebook_ids / model_override provided by the caller
        updated = False
        if notebook_ids is not None and notebook_ids != session.notebook_ids:
            session.notebook_ids = notebook_ids
            updated = True
        if model_override is not None and model_override != session.model_override:
            session.model_override = model_override
            updated = True
        if updated:
            await session.save()

    return session


# ---------------------------------------------------------------------------
# Chat execution
# ---------------------------------------------------------------------------

async def execute_multi_chat(
    session: ChatSession,
    message: str,
    notebook_ids: Optional[List[str]] = None,
    model_override: Optional[str] = None,
) -> dict:
    """
    Build context server-side and run the chat graph.

    Returns the raw result dict from ``chat_graph.invoke()`` which contains
    a ``"messages"`` key with the full conversation.
    """
    effective_notebook_ids = notebook_ids or session.notebook_ids or []
    effective_model = (
        model_override
        if model_override is not None
        else (session.model_override or None)
    )

    full_session_id = (
        str(session.id)
        if str(session.id).startswith("chat_session:")
        else f"chat_session:{session.id}"
    )

    # Build context from all selected notebooks
    context_result = await build_multi_notebook_context(effective_notebook_ids)
    context = context_result["context"]

    # Retrieve current LangGraph checkpoint state
    current_state = await asyncio.to_thread(
        chat_graph.get_state,
        config=RunnableConfig(configurable={"thread_id": full_session_id}),
    )

    state_values = current_state.values if current_state else {}
    state_values["messages"] = state_values.get("messages", [])
    state_values["context"] = context
    state_values["notebook"] = None  # no single notebook; context carries content
    state_values["model_override"] = effective_model

    state_values["messages"].append(HumanMessage(content=message))

    result = chat_graph.invoke(
        input=state_values,
        config=RunnableConfig(
            configurable={
                "thread_id": full_session_id,
                "model_id": effective_model,
            }
        ),
    )

    # Keep session timestamp fresh
    await session.save()

    return result
