'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { AppShell } from '@/components/layout/AppShell'
import { NotebookHeader } from '../components/NotebookHeader'
import { SourcesColumn } from '../components/SourcesColumn'
import { NotesColumn } from '../components/NotesColumn'
import { ChatColumn } from '../components/ChatColumn'
import { useNotebook } from '@/lib/hooks/use-notebooks'
import { useNotebookSources } from '@/lib/hooks/use-sources'
import { useNotes } from '@/lib/hooks/use-notes'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useNotebookColumnsStore } from '@/lib/stores/notebook-columns-store'
import { useIsDesktop } from '@/lib/hooks/use-media-query'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FileText, StickyNote, MessageSquare } from 'lucide-react'
import { notebooksApi } from '@/lib/api/notebooks'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { NotebookResponse } from '@/lib/types/api'

export type ContextMode = 'off' | 'insights' | 'full'

export interface ContextSelections {
  sources: Record<string, ContextMode>
  notes: Record<string, ContextMode>
}

export default function NotebookPage() {
  const { t } = useTranslation()
  const params = useParams()

  // Ensure the notebook ID is properly decoded from URL
  const notebookId = params?.id ? decodeURIComponent(params.id as string) : ''

  const { data: notebook, isLoading: notebookLoading } = useNotebook(notebookId)
  const {
    sources,
    isLoading: sourcesLoading,
    refetch: refetchSources,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useNotebookSources(notebookId)
  const { data: notes, isLoading: notesLoading } = useNotes(notebookId)

  // Get collapse states for dynamic layout
  const { sourcesCollapsed, notesCollapsed } = useNotebookColumnsStore()

  // Detect desktop to avoid double-mounting ChatColumn
  const isDesktop = useIsDesktop()

  // Mobile tab state (Sources, Notes, or Chat)
  const [mobileActiveTab, setMobileActiveTab] = useState<'sources' | 'notes' | 'chat'>('chat')

  // Context selection state
  const [contextSelections, setContextSelections] = useState<ContextSelections>({
    sources: {},
    notes: {}
  })
  // Track the JSON of the last context_config we applied from the server, to avoid
  // re-applying the same config on every background refetch and to detect when
  // a fresh refetch brings a different (newer) config.
  const lastAppliedConfigRef = useRef<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queryClient = useQueryClient()

  // Apply saved context_config from notebook whenever the server data changes.
  // We compare the JSON of the incoming config against what we last applied so
  // that: (a) we DO re-apply after a background refetch returns a newer config,
  // and (b) we DON'T clobber in-session changes after we update the cache ourselves.
  useEffect(() => {
    if (!notebook) return
    const incomingConfigJson = notebook.context_config
      ? JSON.stringify(notebook.context_config)
      : null

    // Skip if this is exactly the same config we already applied
    if (incomingConfigJson === lastAppliedConfigRef.current) return
    lastAppliedConfigRef.current = incomingConfigJson

    if (notebook.context_config) {
      const saved = notebook.context_config
      const toMode = (val: string): ContextMode =>
        val === 'full content' ? 'full' : val === 'not in' ? 'off' : 'insights'
      setContextSelections(prev => ({
        sources: {
          ...prev.sources,
          ...Object.fromEntries(
            Object.entries(saved.sources || {}).map(([id, val]) => [id, toMode(val as string)])
          ),
        },
        notes: {
          ...prev.notes,
          ...Object.fromEntries(
            Object.entries(saved.notes || {}).map(([id, val]) => [id, toMode(val as string)])
          ),
        },
      }))
    }
  }, [notebook])

  // Initialize selections when sources load or change.
  // Only sets a default for sources that have no mode yet; saved config
  // (applied by the notebook effect above) always takes precedence.
  useEffect(() => {
    if (sources && sources.length > 0) {
      setContextSelections(prev => {
        const newSourceSelections = { ...prev.sources }
        sources.forEach(source => {
          if (newSourceSelections[source.id] === undefined) {
            const hasInsights = source.insights_count > 0
            newSourceSelections[source.id] = hasInsights ? 'insights' : 'full'
          }
        })
        return { ...prev, sources: newSourceSelections }
      })
    }
  }, [sources])

  useEffect(() => {
    if (notes && notes.length > 0) {
      setContextSelections(prev => {
        const newNoteSelections = { ...prev.notes }
        notes.forEach(note => {
          if (!(note.id in newNoteSelections)) {
            newNoteSelections[note.id] = 'full'
          }
        })
        return { ...prev, notes: newNoteSelections }
      })
    }
  }, [notes])

  // Helper: build the API payload and save using fetch with keepalive:true.
  // keepalive ensures the request completes even if the user triggers a full
  // page reload (F5) immediately after toggling — which would otherwise cancel
  // a regular axios/fetch request before it reaches the server.
  // Also updates the TanStack Query cache for instant subsequent loads.
  const doSaveContextConfig = useCallback((selections: ContextSelections) => {
    const toApiValue = (mode: ContextMode) =>
      mode === 'full' ? 'full content' : mode === 'off' ? 'not in' : 'insights'
    const contextConfig = {
      sources: Object.fromEntries(
        Object.entries(selections.sources).map(([id, mode]) => [id, toApiValue(mode)])
      ),
      notes: Object.fromEntries(
        Object.entries(selections.notes).map(([id, mode]) => [id, toApiValue(mode)])
      ),
    }
    // Use keepalive fetch so the save survives F5 / navigation
    notebooksApi.saveContextConfigKeepalive(notebookId, contextConfig)
    // Optimistically update cache and ref regardless of network outcome
    lastAppliedConfigRef.current = JSON.stringify(contextConfig)
    queryClient.setQueryData(
      QUERY_KEYS.notebook(notebookId),
      (old: NotebookResponse | undefined) =>
        old ? { ...old, context_config: contextConfig } : old
    )
    return contextConfig
  }, [notebookId, queryClient])

  // Debounced wrapper (300 ms) used while the user is actively toggling modes.
  const persistContextConfig = useCallback((selections: ContextSelections) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      doSaveContextConfig(selections)
    }, 300)
  }, [doSaveContextConfig])

  // Ref that always holds the latest selections so the unmount effect can read it
  // without needing it as a dependency (avoids re-registering cleanup on every change).
  const contextSelectionsRef = useRef(contextSelections)
  useEffect(() => {
    contextSelectionsRef.current = contextSelections
  }, [contextSelections])

  // Flush any pending debounced save on page unload (F5, tab close) AND on
  // React navigation (component unmount).
  //
  // `beforeunload` fires synchronously before the browser unloads the page,
  // giving us a chance to call fetch(keepalive:true) in the same task — which
  // the browser guarantees to complete even after navigation.
  //
  // The useEffect cleanup handles soft React navigation (no full reload).
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
        doSaveContextConfig(contextSelectionsRef.current)
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      // Also flush on React navigation (no full reload)
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
        doSaveContextConfig(contextSelectionsRef.current)
      }
    }
  // doSaveContextConfig is stable (useCallback with stable deps).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doSaveContextConfig])

  // Handler to update context selection
  const handleContextModeChange = (itemId: string, mode: ContextMode, type: 'source' | 'note') => {
    setContextSelections(prev => {
      const next = {
        ...prev,
        [type === 'source' ? 'sources' : 'notes']: {
          ...(type === 'source' ? prev.sources : prev.notes),
          [itemId]: mode
        }
      }
      persistContextConfig(next)
      return next
    })
  }

  if (notebookLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!notebook) {
    return (
      <AppShell>
        <div className="p-6">
          <h1 className="text-2xl font-bold mb-4">{t('notebooks.notFound')}</h1>
          <p className="text-muted-foreground">{t('notebooks.notFoundDesc')}</p>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex-shrink-0 p-6 pb-0">
          <NotebookHeader notebook={notebook} />
        </div>

        <div className="flex-1 p-6 pt-6 overflow-x-auto flex flex-col">
          {/* Mobile: Tabbed interface - only render on mobile to avoid double-mounting */}
          {!isDesktop && (
            <>
              <div className="lg:hidden mb-4">
                <Tabs value={mobileActiveTab} onValueChange={(value) => setMobileActiveTab(value as 'sources' | 'notes' | 'chat')}>
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="sources" className="gap-2">
                      <FileText className="h-4 w-4" />
                      {t('navigation.sources')}
                    </TabsTrigger>
                    <TabsTrigger value="notes" className="gap-2">
                      <StickyNote className="h-4 w-4" />
                      {t('common.notes')}
                    </TabsTrigger>
                    <TabsTrigger value="chat" className="gap-2">
                      <MessageSquare className="h-4 w-4" />
                      {t('common.chat')}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {/* Mobile: Show only active tab */}
              <div className="flex-1 overflow-hidden lg:hidden">
                {mobileActiveTab === 'sources' && (
                  <SourcesColumn
                    sources={sources}
                    isLoading={sourcesLoading}
                    notebookId={notebookId}
                    notebookName={notebook?.name}
                    onRefresh={refetchSources}
                    contextSelections={contextSelections.sources}
                    onContextModeChange={(sourceId, mode) => handleContextModeChange(sourceId, mode, 'source')}
                    hasNextPage={hasNextPage}
                    isFetchingNextPage={isFetchingNextPage}
                    fetchNextPage={fetchNextPage}
                  />
                )}
                {mobileActiveTab === 'notes' && (
                  <NotesColumn
                    notes={notes}
                    isLoading={notesLoading}
                    notebookId={notebookId}
                    contextSelections={contextSelections.notes}
                    onContextModeChange={(noteId, mode) => handleContextModeChange(noteId, mode, 'note')}
                  />
                )}
                {mobileActiveTab === 'chat' && (
                  <ChatColumn
                    notebookId={notebookId}
                    contextSelections={contextSelections}
                    sources={sources}
                    sourcesLoading={sourcesLoading}
                  />
                )}
              </div>
            </>
          )}

          {/* Desktop: Collapsible columns layout */}
          <div className={cn(
            'hidden lg:flex h-full min-h-0 gap-6 transition-all duration-150',
            'flex-row'
          )}>
            {/* Sources Column */}
            <div className={cn(
              'transition-all duration-150',
              sourcesCollapsed ? 'w-12 flex-shrink-0' : 'flex-none basis-1/3'
            )}>
              <SourcesColumn
                sources={sources}
                isLoading={sourcesLoading}
                notebookId={notebookId}
                notebookName={notebook?.name}
                onRefresh={refetchSources}
                contextSelections={contextSelections.sources}
                onContextModeChange={(sourceId, mode) => handleContextModeChange(sourceId, mode, 'source')}
                hasNextPage={hasNextPage}
                isFetchingNextPage={isFetchingNextPage}
                fetchNextPage={fetchNextPage}
              />
            </div>

            {/* Notes Column */}
            <div className={cn(
              'transition-all duration-150',
              notesCollapsed ? 'w-12 flex-shrink-0' : 'flex-none basis-1/3'
            )}>
              <NotesColumn
                notes={notes}
                isLoading={notesLoading}
                notebookId={notebookId}
                contextSelections={contextSelections.notes}
                onContextModeChange={(noteId, mode) => handleContextModeChange(noteId, mode, 'note')}
              />
            </div>

            {/* Chat Column - always expanded, takes remaining space */}
            <div className="transition-all duration-150 flex-1 min-w-0 lg:pr-6 lg:-mr-6">
              <ChatColumn
                notebookId={notebookId}
                contextSelections={contextSelections}
                sources={sources}
                sourcesLoading={sourcesLoading}
              />
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
