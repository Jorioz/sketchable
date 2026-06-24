import { useState, useCallback, useRef } from 'react'

export interface Layer {
  id: number
  name: string
  visible: boolean
  opacity: number
}

const initialLayer: Layer = { id: 1, name: 'Layer 1', visible: true, opacity: 1 }

export function useLayers() {
  const nextId = useRef(2)
  const [layers, setLayers] = useState<Layer[]>([initialLayer])
  const [activeLayerId, setActiveLayerId] = useState(1)

  const addLayer = useCallback(() => {
    const id = nextId.current++
    setLayers(prev => [...prev, { id, name: `Layer ${id}`, visible: true, opacity: 1 }])
    setActiveLayerId(id)
    return id
  }, [])

  const removeLayer = useCallback((layerId: number) => {
    setLayers(prev => {
      if (prev.length <= 1) return prev
      const remaining = prev.filter(l => l.id !== layerId)
      setActiveLayerId(curr => {
        if (curr !== layerId) return curr
        return remaining[remaining.length - 1].id
      })
      return remaining
    })
  }, [])

  const toggleVisibility = useCallback((layerId: number) => {
    setLayers(prev => prev.map(l =>
      l.id === layerId ? { ...l, visible: !l.visible } : l
    ))
  }, [])

  const setLayerOpacity = useCallback((layerId: number, opacity: number) => {
    setLayers(prev => prev.map(l =>
      l.id === layerId ? { ...l, opacity } : l
    ))
  }, [])

  return { layers, activeLayerId, setActiveLayerId, addLayer, removeLayer, toggleVisibility, setLayerOpacity }
}
