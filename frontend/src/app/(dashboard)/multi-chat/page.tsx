'use client'

import { AppShell } from '@/components/layout/AppShell'
import { NotebookPicker } from './components/NotebookPicker'
import { MultiChatColumn } from './components/MultiChatColumn'
import { useChatConfigStore } from '@/lib/stores/chat-config-store'
import { useTranslation } from '@/lib/hooks/use-translation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'

export default function MultiChatPage() {
  const { t } = useTranslation()
  const { selectedNotebookIds, clear } = useChatConfigStore()

  return (
    <AppShell>
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="border-b px-6 py-4 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold">{t('multiChat.title')}</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {t('multiChat.description')}
              </p>
            </div>
            {selectedNotebookIds.length > 0 && (
              <div className="flex items-center gap-2">
                <Badge variant="secondary">
                  {selectedNotebookIds.length} {t('multiChat.selected')}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clear}
                  className="h-7 w-7 p-0"
                  aria-label={t('multiChat.clearSelection')}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Main content: two columns */}
        <div className="flex-1 overflow-hidden grid grid-cols-[320px_1fr] gap-0">
          {/* Left panel: notebook selection */}
          <div className="border-r overflow-y-auto p-4 space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              {t('multiChat.configureNotebooks')}
            </h2>
            <NotebookPicker />
          </div>

          {/* Right panel: chat */}
          <div className="overflow-hidden p-4">
            <MultiChatColumn notebookIds={selectedNotebookIds} />
          </div>
        </div>
      </div>
    </AppShell>
  )
}
