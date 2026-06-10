import apiClient from './client'
import { getApiUrl, getCachedApiUrlSync } from '@/lib/config'
import {
  NotebookResponse,
  NotebookContextConfig,
  CreateNotebookRequest,
  UpdateNotebookRequest,
  NotebookDeletePreview,
  NotebookDeleteResponse,
} from '@/lib/types/api'

/**
 * Build the auth + content headers the same way the axios interceptor does,
 * so we can replicate them in plain `fetch` calls.
 */
function buildFetchHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    if (typeof window !== 'undefined') {
      const authStorage = localStorage.getItem('auth-storage')
      if (authStorage) {
        const { state } = JSON.parse(authStorage)
        if (state?.token) headers['Authorization'] = `Bearer ${state.token}`
      }
    }
  } catch { /* ignore */ }
  return headers
}

export const notebooksApi = {
  list: async (params?: { archived?: boolean; order_by?: string }) => {
    const response = await apiClient.get<NotebookResponse[]>('/notebooks', { params })
    return response.data
  },

  get: async (id: string) => {
    const response = await apiClient.get<NotebookResponse>(`/notebooks/${id}`)
    return response.data
  },

  create: async (data: CreateNotebookRequest) => {
    const response = await apiClient.post<NotebookResponse>('/notebooks', data)
    return response.data
  },

  update: async (id: string, data: UpdateNotebookRequest) => {
    const response = await apiClient.put<NotebookResponse>(`/notebooks/${id}`, data)
    return response.data
  },

  deletePreview: async (id: string) => {
    const response = await apiClient.get<NotebookDeletePreview>(
      `/notebooks/${id}/delete-preview`
    )
    return response.data
  },

  delete: async (id: string, deleteExclusiveSources: boolean = false) => {
    const response = await apiClient.delete<NotebookDeleteResponse>(`/notebooks/${id}`, {
      params: { delete_exclusive_sources: deleteExclusiveSources },
    })
    return response.data
  },

  addSource: async (notebookId: string, sourceId: string) => {
    const response = await apiClient.post(`/notebooks/${notebookId}/sources/${sourceId}`)
    return response.data
  },

  removeSource: async (notebookId: string, sourceId: string) => {
    const response = await apiClient.delete(`/notebooks/${notebookId}/sources/${sourceId}`)
    return response.data
  },

  saveContextConfig: async (notebookId: string, contextConfig: NotebookContextConfig) => {
    await apiClient.put(`/notebooks/${notebookId}/context-config`, contextConfig)
  },

  /**
   * Same as saveContextConfig but uses native fetch with `keepalive: true`.
   *
   * `keepalive` tells the browser to keep the HTTP request alive even when the
   * page is being unloaded (F5, tab close, navigation).  This prevents the save
   * from being silently cancelled when the user refreshes immediately after
   * toggling a context mode.
   *
   * Critically this function calls `fetch()` **synchronously** (no async
   * preamble) so it works correctly inside `beforeunload` handlers and React
   * cleanup effects that run during page unload — where Promise chains may
   * never resolve because the JS task queue is frozen.
   *
   * Falls back to the async `getApiUrl()` path only when the sync cache is
   * not yet populated (i.e. very first page load before any API call).
   *
   * This is a fire-and-forget call — it never throws; errors are swallowed.
   */
  saveContextConfigKeepalive: (notebookId: string, contextConfig: NotebookContextConfig): void => {
    const body = JSON.stringify(contextConfig)
    const headers = buildFetchHeaders()
    const doFetch = (apiUrl: string) => {
      try {
        fetch(`${apiUrl}/api/notebooks/${notebookId}/context-config`, {
          method: 'PUT',
          headers,
          body,
          keepalive: true,
        }).catch(() => { /* silent */ })
      } catch { /* silent */ }
    }

    // Prefer the synchronous cached URL so fetch() is called in the same
    // task — essential during page unload when microtasks may be frozen.
    const cachedUrl = getCachedApiUrlSync()
    if (cachedUrl !== null) {
      doFetch(cachedUrl)
    } else {
      // Config not yet cached — fall back to async path (normal mid-session save).
      getApiUrl().then(doFetch).catch(() => { /* silent */ })
    }
  },
}