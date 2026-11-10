import { useState, useCallback } from 'react'

export function usePlaceSelection() {
  const [selectedPlaceId, _setSelectedPlaceId] = useState<number | null>(null)
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<number | null>(null)

  // Accepts a value or an updater, like useState's setter — the planner toggles
  // the selection with `prev => prev === id ? null : id`, which used to store
  // the function itself as the selected id.
  const setSelectedPlaceId = useCallback((placeId: number | null | ((prev: number | null) => number | null)) => {
    _setSelectedPlaceId(placeId)
    setSelectedAssignmentId(null)
  }, [])

  const selectAssignment = useCallback((assignmentId: number | null, placeId: number | null = null) => {
    setSelectedAssignmentId(assignmentId)
    _setSelectedPlaceId(placeId)
  }, [])

  return { selectedPlaceId, selectedAssignmentId, setSelectedPlaceId, selectAssignment }
}
