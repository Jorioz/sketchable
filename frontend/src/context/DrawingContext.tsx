import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export type Tool = 'marker' | 'pencil' | 'highlighter' | 'eraser'

interface DrawingContextValue {
  tool: Tool
  setTool: (t: Tool) => void
  color: string
  pickColor: (c: string) => void
  opacity: number
  setOpacity: (v: number) => void
  brushSize: number
  setBrushSize: (s: number) => void
  canUndo: boolean
  setCanUndo: (v: boolean) => void
  canRedo: boolean
  setCanRedo: (v: boolean) => void
  handleUndo: () => void
  handleRedo: () => void
  handleClear: () => void
  /** Flatten the current sketch to a PNG data URL, or null if nothing to export. */
  handleExport: () => string | null
  registerHandlers: (
    undo: () => void,
    redo: () => void,
    clear: () => void,
    exportPNG: () => string | null,
  ) => void
}

const DrawingContext = createContext<DrawingContextValue | null>(null)

export function DrawingProvider({ children }: { children: ReactNode }) {
  const [tool, setTool] = useState<Tool>('marker')
  const [color, setColor] = useState('#000000')
  const [opacity, setOpacity] = useState(1)
  const [brushSize, setBrushSize] = useState(6)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const undoRef = useRef<() => void>(() => {})
  const redoRef = useRef<() => void>(() => {})
  const clearRef = useRef<() => void>(() => {})
  const exportRef = useRef<() => string | null>(() => null)

  const pickColor = useCallback((c: string) => {
    setColor(c)
    setTool(prev => (prev === 'eraser' ? 'marker' : prev))
  }, [])

  const registerHandlers = useCallback(
    (
      undo: () => void,
      redo: () => void,
      clear: () => void,
      exportPNG: () => string | null,
    ) => {
      undoRef.current = undo
      redoRef.current = redo
      clearRef.current = clear
      exportRef.current = exportPNG
    },
    [],
  )

  const handleUndo = useCallback(() => undoRef.current(), [])
  const handleRedo = useCallback(() => redoRef.current(), [])
  const handleClear = useCallback(() => clearRef.current(), [])
  const handleExport = useCallback(() => exportRef.current(), [])

  return (
    <DrawingContext.Provider value={{
      tool, setTool,
      color, pickColor,
      opacity, setOpacity,
      brushSize, setBrushSize,
      canUndo, setCanUndo,
      canRedo, setCanRedo,
      handleUndo, handleRedo, handleClear, handleExport,
      registerHandlers,
    }}>
      {children}
    </DrawingContext.Provider>
  )
}

export function useDrawing(): DrawingContextValue {
  const ctx = useContext(DrawingContext)
  if (!ctx) throw new Error('useDrawing must be used inside DrawingProvider')
  return ctx
}
