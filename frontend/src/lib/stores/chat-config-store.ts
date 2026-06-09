import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ChatConfigState {
  selectedNotebookIds: string[]
  toggleNotebook: (id: string) => void
  setSelected: (ids: string[]) => void
  clear: () => void
}

export const useChatConfigStore = create<ChatConfigState>()(
  persist(
    (set) => ({
      selectedNotebookIds: [],
      toggleNotebook: (id) =>
        set((state) => ({
          selectedNotebookIds: state.selectedNotebookIds.includes(id)
            ? state.selectedNotebookIds.filter((n) => n !== id)
            : [...state.selectedNotebookIds, id],
        })),
      setSelected: (ids) => set({ selectedNotebookIds: ids }),
      clear: () => set({ selectedNotebookIds: [] }),
    }),
    {
      name: 'chat-config-storage',
    }
  )
)
