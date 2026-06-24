import { useState } from 'react'
import { IoTrash } from 'react-icons/io5'
import { useDrawing } from '../context/DrawingContext'
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

// Solo trash button — wipes the canvas after a confirm prompt.
export default function ClearCanvas() {
  const { canUndo, handleClear } = useDrawing()
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-full bg-black/5 p-1">
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger
          disabled={!canUndo}
          aria-label="Clear canvas"
          className="flex items-center justify-center w-8 h-8 rounded-full text-red-500 transition-transform active:scale-90 disabled:opacity-30"
        >
          <IoTrash className="size-[18px]" />
        </AlertDialogTrigger>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete drawing?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete your drawing? This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                handleClear()
                setOpen(false)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
