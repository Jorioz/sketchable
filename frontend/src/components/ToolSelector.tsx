import { useDrawing } from '../context/DrawingContext'
import type { Tool } from '../context/DrawingContext'
import type { IconType } from 'react-icons'
import { PiEraser, PiPencil, PiHighlighter, PiPen } from 'react-icons/pi'
import { cn } from '@/lib/utils'

// PiPen stands in for the Marker (the solid primary tool).
const TOOLS: { id: Tool; Icon: IconType }[] = [
  { id: 'marker', Icon: PiPen },
  { id: 'pencil', Icon: PiPencil },
  { id: 'highlighter', Icon: PiHighlighter },
  { id: 'eraser', Icon: PiEraser },
]

export default function ToolSelector() {
  const { tool, setTool, color } = useDrawing()

  return (
    <div className="flex flex-row justify-around">
      {TOOLS.map(({ id, Icon }) => {
        const active = tool === id
        // The eraser has no draw color — give it a neutral accent.
        const accent = id === 'eraser' ? '#6b7280' : color
        return (
          <button
            key={id}
            onClick={() => setTool(id)}
            className={cn(
              'flex items-center justify-center w-12 h-12 rounded-full',
              'transition-all duration-200 select-none touch-manipulation',
              active ? 'scale-110' : '',
            )}
            style={{
              // Flat filled chip: accent-tinted when active, neutral when not.
              background: active ? `${accent}22` : '#f1f1f3',
              boxShadow: active ? `0 4px 12px ${accent}33` : undefined,
            }}
          >
            <Icon size={22} color={active ? accent : '#6b7280'} />
          </button>
        )
      })}
    </div>
  )
}
