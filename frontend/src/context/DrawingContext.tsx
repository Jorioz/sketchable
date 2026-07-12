import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export type Tool = 'marker' | 'pencil' | 'highlighter' | 'eraser'

export const MIN_ZOOM = 1
export const MAX_ZOOM = 5

interface DrawingContextValue {
  tool: Tool
  setTool: (t: Tool) => void
  color: string
  pickColor: (c: string) => void
  opacity: number
  setOpacity: (v: number) => void
  brushSize: number
  setBrushSize: (s: number) => void
  /** Canvas zoom factor, clamped to [MIN_ZOOM, MAX_ZOOM] (1 = 100%). */
  zoom: number
  setZoom: (z: number) => void
  /**
   * Move mode: while on, touch/drag on the canvas pans and pinches (zoom)
   * instead of drawing. Off by default — drawing is the normal state.
   */
  moveMode: boolean
  setMoveMode: (v: boolean) => void
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
  const [zoom, setZoomState] = useState(1)
  const [moveMode, setMoveMode] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const undoRef = useRef<() => void>(() => {})
  const redoRef = useRef<() => void>(() => {})
  const clearRef = useRef<() => void>(() => {})
  const exportRef = useRef<() => string | null>(() => null)

  const setZoom = useCallback((z: number) => {
    setZoomState(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)))
  }, [])

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
      zoom, setZoom,
      moveMode, setMoveMode,
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
