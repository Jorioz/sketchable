import { IoArrowUndo, IoArrowRedo } from 'react-icons/io5'
import { useDrawing } from '../context/DrawingContext'

export default function UndoRedo() {
  const { canUndo, canRedo, handleUndo, handleRedo } = useDrawing()

  return (
    <div className="flex items-center gap-1 rounded-full bg-black/5 p-1">
      <button
        onClick={handleUndo}
        disabled={!canUndo}
        aria-label="Undo"
        className="flex items-center justify-center w-8 h-8 rounded-full transition-transform active:scale-90 disabled:opacity-30"
      >
        <IoArrowUndo className="size-[18px]" />
      </button>
      <button
        onClick={handleRedo}
        disabled={!canRedo}
        aria-label="Redo"
        className="flex items-center justify-center w-8 h-8 rounded-full transition-transform active:scale-90 disabled:opacity-30"
      >
        <IoArrowRedo className="size-[18px]" />
      </button>
    </div>
  )
}
