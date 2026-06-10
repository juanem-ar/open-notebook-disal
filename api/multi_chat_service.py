"""
Multi-notebook chat service.

Centralises the logic shared by:
- POST /chat/multi/execute  (rich UI response with full message list)
- POST /chat/ask            (flat response for n8n / Teams integration)
"""

import asyncio
import re
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from langchain_core.messages import HumanMessage
from langchain_core.runnables import RunnableConfig
from loguru import logger

from open_notebook.config import LANGGRAPH_CHECKPOINT_FILE
from open_notebook.domain.notebook import ChatSession, Note, Notebook
from open_notebook.graphs.chat import graph as chat_graph


def _purge_thread_checkpoints(thread_id: str) -> None:
    """
    Delete all LangGraph checkpoint rows for *thread_id* from the SQLite store.

    Called when a session resets (TTL expiry or no-memory mode) so the next
    conversation starts with a clean slate instead of loading old messages.
    Errors are swallowed — a stale checkpoint is preferable to a crash.
    """
    try:
        with sqlite3.connect(LANGGRAPH_CHECKPOINT_FILE) as conn:
            cur = conn.cursor()
            # LangGraph SqliteSaver uses 'checkpoints' and 'writes' tables.
            cur.execute("DELETE FROM checkpoints WHERE thread_id = ?", (thread_id,))
            deleted_cp = cur.rowcount
            cur.execute("DELETE FROM writes WHERE thread_id = ?", (thread_id,))
            deleted_wr = cur.rowcount
            conn.commit()
            logger.info(
                f"Purged LangGraph state for thread {thread_id!r}: "
                f"{deleted_cp} checkpoints, {deleted_wr} writes."
            )
    except Exception as exc:
        logger.warning(f"Could not purge checkpoints for {thread_id!r}: {exc}")


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

        saved_cfg = notebook.context_config or {}
        # Normalise keys to strings in case SurrealDB returned RecordID objects
        source_cfg: dict = {str(k): str(v) for k, v in saved_cfg.get("sources", {}).items()}
        note_cfg: dict = {str(k): str(v) for k, v in saved_cfg.get("notes", {}).items()}

        # Sources
        try:
            sources = await notebook.get_sources()
        except Exception as exc:
            logger.warning(f"Could not load sources for {notebook_id}: {exc}")
            sources = []

        for source in sources:
            try:
                src_id = str(source.id)
                status = source_cfg.get(src_id, "insights")
                if "not in" in status:
                    continue
                size = "long" if "full content" in status else "short"
                src_ctx = await source.get_context(context_size=size)
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
                note_id = str(note.id)
                status = note_cfg.get(note_id, "full content")
                if "not in" in status:
                    continue
                # get_notes() omits content for performance; refetch the full record
                full_note = await Note.get(note_id)
                if not full_note:
                    continue
                size = "long" if "full content" in status else "short"
                note_ctx = full_note.get_context(context_size=size)
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

async def _get_min_ttl_minutes(notebook_ids: List[str]) -> Optional[int]:
    """
    Return the smallest session_ttl_minutes across *notebook_ids*, or None if
    all notebooks have permanent sessions (TTL not configured).
    """
    min_ttl: Optional[int] = None
    for nb_id in notebook_ids:
        try:
            nb = await Notebook.get(nb_id)
            if nb and nb.session_ttl_minutes is not None:
                if min_ttl is None or nb.session_ttl_minutes < min_ttl:
                    min_ttl = nb.session_ttl_minutes
        except Exception:
            pass
    return min_ttl


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

    If any notebook has a ``session_ttl_minutes`` configured and the session
    has been idle for longer than that TTL, the session is auto-reset by
    incrementing its ``session_version``.  The next ``execute_multi_chat``
    call will use a new LangGraph thread, starting a fresh conversation.
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
            session_version=0,
            created=datetime.now(),
        )
        await session.save()
        logger.info(f"Created new multi-chat session {session.id}")
    else:
        # Check TTL expiry against the effective notebook list
        ttl_bumped = False
        effective_nb_ids = notebook_ids or session.notebook_ids or []
        if effective_nb_ids:
            min_ttl = await _get_min_ttl_minutes(effective_nb_ids)
            if min_ttl is not None and min_ttl > 0:
                last_activity = session.updated or session.created
                if last_activity is not None:
                    now_utc = datetime.now(timezone.utc)
                    if last_activity.tzinfo is None:
                        last_utc = last_activity.replace(tzinfo=timezone.utc)
                    else:
                        last_utc = last_activity
                    age_seconds = (now_utc - last_utc).total_seconds()
                    if age_seconds > min_ttl * 60:
                        # Compute the old thread_id so we can wipe its checkpoints
                        old_version = session.session_version or 0
                        old_full_id = (
                            str(session.id)
                            if str(session.id).startswith("chat_session:")
                            else f"chat_session:{session.id}"
                        )
                        old_thread_id = (
                            f"{old_full_id}_v{old_version}"
                            if old_version > 0
                            else old_full_id
                        )
                        # Purge stale LangGraph state before bumping the version
                        await asyncio.to_thread(_purge_thread_checkpoints, old_thread_id)

                        session.session_version = old_version + 1
                        ttl_bumped = True
                        logger.info(
                            f"Session {session_id!r} expired "
                            f"(TTL={min_ttl}min, idle={age_seconds:.0f}s). "
                            f"Bumped to v{session.session_version} — fresh thread."
                        )

        # Persist any changes
        needs_save = ttl_bumped
        if notebook_ids is not None and notebook_ids != session.notebook_ids:
            session.notebook_ids = notebook_ids
            needs_save = True
        if model_override is not None and model_override != session.model_override:
            session.model_override = model_override
            needs_save = True
        if needs_save:
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

    # Build a versioned LangGraph thread_id so TTL-reset sessions start with
    # a fresh checkpoint (no old conversation history).
    version = session.session_version or 0
    thread_id = f"{full_session_id}_v{version}" if version > 0 else full_session_id

    # Build context from all selected notebooks
    context_result = await build_multi_notebook_context(effective_notebook_ids)
    context = context_result["context"]

    # Retrieve current LangGraph checkpoint state
    current_state = await asyncio.to_thread(
        chat_graph.get_state,
        config=RunnableConfig(configurable={"thread_id": thread_id}),
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
                "thread_id": thread_id,
                "model_id": effective_model,
            }
        ),
    )

    # If any notebook is configured as "no memory" (TTL=0), purge the checkpoint
    # that was just written and bump session_version so the NEXT request uses a
    # brand-new LangGraph thread with no prior messages.
    if effective_notebook_ids:
        min_ttl = await _get_min_ttl_minutes(effective_notebook_ids)
        if min_ttl is not None and min_ttl == 0:
            # Purge the thread we just used
            await asyncio.to_thread(_purge_thread_checkpoints, thread_id)
            session.session_version = (session.session_version or 0) + 1
            logger.info(
                f"No-memory session {session.id!r}: purged thread {thread_id!r}, "
                f"bumped to v{session.session_version} — next call will start fresh."
            )

    # Keep session timestamp fresh (also persists any version bump above)
    await session.save()

    return result
