'use client'

import { useState } from 'react'
import { NotebookResponse } from '@/lib/types/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Archive, ArchiveRestore, Trash2, Timer } from 'lucide-react'
import { useUpdateNotebook } from '@/lib/hooks/use-notebooks'
import { NotebookDeleteDialog } from './NotebookDeleteDialog'
import { formatDistanceToNow } from 'date-fns'
import { getDateLocale } from '@/lib/utils/date-locale'
import { InlineEdit } from '@/components/common/InlineEdit'
import { useTranslation } from '@/lib/hooks/use-translation'

/** Available TTL options for /chat/ask sessions. */
const TTL_OPTIONS: { label: string; value: number | null; description?: string }[] = [
  { label: 'Sin memoria', value: 0, description: 'Cada respuesta inicia sesión nueva' },
  { label: 'Permanente', value: null, description: 'La sesión nunca expira' },
  { label: '3 minutos', value: 3 },
  { label: '10 minutos', value: 10 },
  { label: '30 minutos', value: 30 },
  { label: '1 hora', value: 60 },
]

function ttlLabel(minutes: number | null | undefined): string {
  if (minutes === 0) return 'Sin memoria'
  if (minutes == null) return 'Permanente'
  const opt = TTL_OPTIONS.find(o => o.value === minutes)
  return opt ? opt.label : `${minutes} min`
}

interface NotebookHeaderProps {
  notebook: NotebookResponse
}

export function NotebookHeader({ notebook }: NotebookHeaderProps) {
  const { t, language } = useTranslation()
  const dfLocale = getDateLocale(language)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  
  const updateNotebook = useUpdateNotebook()

  const handleUpdateName = async (name: string) => {
    if (!name || name === notebook.name) return
    
    await updateNotebook.mutateAsync({
      id: notebook.id,
      data: { name }
    })
  }

  const handleUpdateDescription = async (description: string) => {
    if (description === notebook.description) return
    
    await updateNotebook.mutateAsync({
      id: notebook.id,
      data: { description: description || undefined }
    })
  }

  const handleArchiveToggle = () => {
    updateNotebook.mutate({
      id: notebook.id,
      data: { archived: !notebook.archived }
    })
  }

  const handleTtlChange = (minutes: number | null) => {
    updateNotebook.mutate({
      id: notebook.id,
      // Send -1 as sentinel for "clear TTL" (backend converts -1 → null).
      data: { session_ttl_minutes: minutes === null ? -1 : minutes }
    })
  }

  return (
    <>
      <div className="border-b pb-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1">
              <InlineEdit
                id="notebook-name"
                name="notebook-name"
                value={notebook.name}
                onSave={handleUpdateName}
                className="text-2xl font-bold"
                inputClassName="text-2xl font-bold"
                placeholder={t('notebooks.namePlaceholder')}
              />
              {notebook.archived && (
                <Badge variant="secondary">{t('notebooks.archived')}</Badge>
              )}
            </div>
            <div className="flex gap-2">
              {/* Session TTL selector for /chat/ask integrations */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" title="Duración de sesión (chat/ask)">
                    <Timer className="h-4 w-4 mr-2" />
                    {ttlLabel(notebook.session_ttl_minutes)}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                    Duración de sesión (/chat/ask)
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {TTL_OPTIONS.map(opt => {
                    const isActive = (notebook.session_ttl_minutes ?? null) === opt.value
                    return (
                      <DropdownMenuItem
                        key={String(opt.value)}
                        onClick={() => handleTtlChange(opt.value)}
                        className={isActive ? 'font-semibold' : ''}
                      >
                        <div className="flex flex-col">
                          <span>{opt.label}</span>
                          {opt.description && (
                            <span className="text-[10px] text-muted-foreground">{opt.description}</span>
                          )}
                        </div>
                        {isActive && (
                          <span className="ml-auto text-primary">✓</span>
                        )}
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="outline"
                size="sm"
                onClick={handleArchiveToggle}
              >
                {notebook.archived ? (
                  <>
                    <ArchiveRestore className="h-4 w-4 mr-2" />
                    {t('notebooks.unarchive')}
                  </>
                ) : (
                  <>
                    <Archive className="h-4 w-4 mr-2" />
                    {t('notebooks.archive')}
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDeleteDialog(true)}
                className="text-red-600 hover:text-red-700"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {t('common.delete')}
              </Button>
            </div>
          </div>
          
          <InlineEdit
            id="notebook-description"
            name="notebook-description"
            value={notebook.description || ''}
            onSave={handleUpdateDescription}
            className="text-muted-foreground"
            inputClassName="text-muted-foreground"
            placeholder={t('notebooks.addDescription')}
            multiline
            emptyText={t('notebooks.addDescription')}
          />
          
          <div className="text-sm text-muted-foreground">
            {t('common.created').replace('{time}', formatDistanceToNow(new Date(notebook.created), { addSuffix: true, locale: dfLocale }))} • 
            {t('common.updated').replace('{time}', formatDistanceToNow(new Date(notebook.updated), { addSuffix: true, locale: dfLocale }))}
          </div>
        </div>
      </div>

      <NotebookDeleteDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        notebookId={notebook.id}
        notebookName={notebook.name}
        redirectAfterDelete
      />
    </>
  )
}