'use client'

import { useMultiNotebookChat } from '@/lib/hooks/useMultiNotebookChat'
import { ChatPanel } from '@/components/source/ChatPanel'
import { useTranslation } from '@/lib/hooks/use-translation'
import { Card, CardContent } from '@/components/ui/card'
import { MessageSquare } from 'lucide-react'

interface MultiChatColumnProps {
  notebookIds: string[]
}

export function MultiChatColumn({ notebookIds }: MultiChatColumnProps) {
  const { t } = useTranslation()
  const chat = useMultiNotebookChat({ notebookIds })

  if (notebookIds.length === 0) {
    return (
      <Card className="h-full flex flex-col">
        <CardContent className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p className="text-sm">{t('multiChat.selectNotebooksFirst')}</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <ChatPanel
      title={t('multiChat.chatTitle')}
      contextType="notebook"
      messages={chat.messages}
      isStreaming={chat.isSending}
      contextIndicators={null}
      onSendMessage={(message, modelOverride) => chat.sendMessage(message, modelOverride)}
      modelOverride={chat.pendingModelOverride ?? undefined}
      onModelChange={(model) => chat.setModelOverride(model ?? null)}
      sessions={[]}
      currentSessionId={chat.currentSessionId}
      onCreateSession={() => chat.newSession()}
      loadingSessions={false}
    />
  )
}
