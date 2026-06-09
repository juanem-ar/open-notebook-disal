'use client'

import { useState, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getApiErrorMessage } from '@/lib/utils/error-handler'
import { useTranslation } from '@/lib/hooks/use-translation'
import { chatApi } from '@/lib/api/chat'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { NotebookChatMessage } from '@/lib/types/api'

interface UseMultiNotebookChatParams {
  notebookIds: string[]
}

export function useMultiNotebookChat({ notebookIds }: UseMultiNotebookChatParams) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<NotebookChatMessage[]>([])
  const [isSending, setIsSending] = useState(false)
  const [pendingModelOverride, setPendingModelOverride] = useState<string | null>(null)

  // Create session mutation
  const createSessionMutation = useMutation({
    mutationFn: (title?: string) =>
      chatApi.createMultiSession({
        notebook_ids: notebookIds,
        title,
      }),
    onSuccess: (newSession) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.multiChatSessions })
      setCurrentSessionId(newSession.id)
      toast.success(t('chat.sessionCreated'))
    },
    onError: (err: unknown) => {
      const error = err as { response?: { data?: { detail?: string } }; message?: string }
      toast.error(
        getApiErrorMessage(
          error.response?.data?.detail || error.message,
          (key) => t(key),
          'apiErrors.failedToCreateSession'
        )
      )
    },
  })

  const sendMessage = useCallback(
    async (message: string, modelOverride?: string) => {
      let sessionId = currentSessionId

      // Auto-create session if none exists
      if (!sessionId) {
        if (notebookIds.length === 0) {
          toast.error(t('multiChat.selectNotebooksFirst'))
          return
        }
        try {
          const defaultTitle =
            message.length > 30 ? `${message.substring(0, 30)}...` : message
          const newSession = await chatApi.createMultiSession({
            notebook_ids: notebookIds,
            title: defaultTitle,
            model_override: pendingModelOverride ?? undefined,
          })
          sessionId = newSession.id
          setCurrentSessionId(sessionId)
          setPendingModelOverride(null)
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.multiChatSessions })
        } catch (err: unknown) {
          const error = err as { response?: { data?: { detail?: string } }; message?: string }
          toast.error(
            getApiErrorMessage(
              error.response?.data?.detail || error.message,
              (key) => t(key),
              'apiErrors.failedToCreateSession'
            )
          )
          return
        }
      }

      // Optimistic update
      const userMessage: NotebookChatMessage = {
        id: `temp-${Date.now()}`,
        type: 'human',
        content: message,
        timestamp: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, userMessage])
      setIsSending(true)

      try {
        const response = await chatApi.executeMulti({
          session_id: sessionId,
          message,
          model_override: modelOverride ?? pendingModelOverride ?? undefined,
        })
        setMessages(response.messages)
      } catch (err: unknown) {
        const error = err as { response?: { data?: { detail?: string } }; message?: string }
        console.error('Error sending multi-chat message:', error)
        toast.error(
          getApiErrorMessage(
            error.response?.data?.detail || error.message,
            (key) => t(key),
            'apiErrors.failedToSendMessage'
          )
        )
        setMessages((prev) => prev.filter((msg) => !msg.id.startsWith('temp-')))
      } finally {
        setIsSending(false)
      }
    },
    [notebookIds, currentSessionId, pendingModelOverride, queryClient, t]
  )

  const newSession = useCallback(() => {
    setCurrentSessionId(null)
    setMessages([])
  }, [])

  const setModelOverride = useCallback(
    (model: string | null) => {
      setPendingModelOverride(model)
    },
    []
  )

  return {
    currentSessionId,
    messages,
    isSending,
    pendingModelOverride,
    sendMessage,
    newSession,
    setModelOverride,
  }
}
