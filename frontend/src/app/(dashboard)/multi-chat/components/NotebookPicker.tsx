'use client'

import { useChatConfigStore } from '@/lib/stores/chat-config-store'
import { useNotebooks } from '@/lib/hooks/use-notebooks'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useTranslation } from '@/lib/hooks/use-translation'
import { Book } from 'lucide-react'

export function NotebookPicker() {
  const { t } = useTranslation()
  const { data: notebooks, isLoading } = useNotebooks(false)
  const { selectedNotebookIds, toggleNotebook } = useChatConfigStore()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingSpinner size="md" />
      </div>
    )
  }

  if (!notebooks || notebooks.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Book className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p className="text-sm">{t('multiChat.noNotebooks')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {notebooks.map((notebook) => {
        const isSelected = selectedNotebookIds.includes(notebook.id)
        return (
          <Card
            key={notebook.id}
            className={`cursor-pointer transition-colors hover:bg-accent ${
              isSelected ? 'border-primary bg-accent/50' : ''
            }`}
            onClick={() => toggleNotebook(notebook.id)}
          >
            <CardContent className="flex items-center gap-3 p-3">
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => toggleNotebook(notebook.id)}
                aria-label={notebook.name}
              />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{notebook.name}</p>
                {notebook.description && (
                  <p className="text-xs text-muted-foreground truncate">
                    {notebook.description}
                  </p>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                {notebook.source_count > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {notebook.source_count} {t('multiChat.sources')}
                  </Badge>
                )}
                {notebook.note_count > 0 && (
                  <Badge variant="outline" className="text-xs">
                    {notebook.note_count} {t('multiChat.notes')}
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
