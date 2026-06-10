'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Loader2, Trash2, CheckCircle2, AlertCircle } from 'lucide-react'
import { chatApi } from '@/lib/api/chat'

export function ClearSessions() {
  const [result, setResult] = useState<{
    sessions_deleted: number
    checkpoints_deleted: number
    writes_deleted: number
  } | null>(null)

  const clearMutation = useMutation({
    mutationFn: () => chatApi.clearAllSessions(),
    onSuccess: (data) => {
      setResult({
        sessions_deleted: data.sessions_deleted,
        checkpoints_deleted: data.checkpoints_deleted,
        writes_deleted: data.writes_deleted,
      })
    },
  })

  const handleReset = () => {
    setResult(null)
    clearMutation.reset()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trash2 className="h-5 w-5" />
          Limpiar sesiones de chat
        </CardTitle>
        <CardDescription>
          Elimina todas las sesiones de chat y su historial de conversación (SurrealDB + SQLite).
          Útil para limpiar sesiones de integraciones externas (Teams, n8n) o resetear el estado del sistema.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!result && (
          <>
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Esta acción elimina <strong>todas</strong> las sesiones y su historial completo de mensajes.
                Las sesiones del chat interno se recrean automáticamente al volver a chatear.
                Las sesiones de integraciones externas (Teams, n8n) empezarán desde cero.
              </AlertDescription>
            </Alert>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  disabled={clearMutation.isPending}
                  className="w-full"
                >
                  {clearMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Limpiando...
                    </>
                  ) : (
                    <>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Limpiar todas las sesiones
                    </>
                  )}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Confirmar limpieza?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Se eliminarán todas las sesiones de chat y su historial de mensajes de forma permanente.
                    Esta acción no se puede deshacer.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => clearMutation.mutate()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Sí, limpiar todo
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {clearMutation.isError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Error: {(clearMutation.error as Error)?.message || 'Error desconocido'}
                </AlertDescription>
              </Alert>
            )}
          </>
        )}

        {result && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-medium">Limpieza completada</span>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1 text-center">
                <p className="text-2xl font-bold">{result.sessions_deleted}</p>
                <p className="text-sm text-muted-foreground">Sesiones eliminadas</p>
              </div>
              <div className="space-y-1 text-center">
                <p className="text-2xl font-bold">{result.checkpoints_deleted}</p>
                <p className="text-sm text-muted-foreground">Checkpoints borrados</p>
              </div>
              <div className="space-y-1 text-center">
                <p className="text-2xl font-bold">{result.writes_deleted}</p>
                <p className="text-sm text-muted-foreground">Writes borrados</p>
              </div>
            </div>

            <Button variant="outline" onClick={handleReset} className="w-full">
              Listo
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
