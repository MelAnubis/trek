import { describe, it, expect } from 'vitest'
import { projectPreview, pageList, folderColor, filterParams, type PreviewPoint } from './plannerLibrary'

describe('projectPreview', () => {
  const diag: PreviewPoint[] = [[40, -4], [41, -3]]

  it('cabe en el rectángulo, con margen, y conserva inicio y fin', () => {
    const r = projectPreview(diag, 100, 60, 8)!
    const nums = r.d.replace(/[ML]/g, ' ').trim().split(/\s+/).map(Number)
    for (let i = 0; i < nums.length; i += 2) {
      expect(nums[i]).toBeGreaterThanOrEqual(8 - 0.1); expect(nums[i]).toBeLessThanOrEqual(92 + 0.1)
      expect(nums[i + 1]).toBeGreaterThanOrEqual(8 - 0.1); expect(nums[i + 1]).toBeLessThanOrEqual(52 + 0.1)
    }
    expect(r.start).toEqual([nums[0], nums[1]])
    expect(r.end).toEqual([nums[2], nums[3]])
  })

  it('el norte queda arriba (y menor) y el este a la derecha', () => {
    const r = projectPreview(diag, 100, 60)!   // sur-oeste → norte-este
    expect(r.end[1]).toBeLessThan(r.start[1])
    expect(r.end[0]).toBeGreaterThan(r.start[0])
  })

  it('una ruta recta este-oeste no se sale ni da NaN', () => {
    const r = projectPreview([[40, -4], [40, -3], [40, -2]], 100, 60)!
    expect(r.d).not.toContain('NaN')
    expect(r.start[1]).toBeCloseTo(r.end[1], 5)
  })

  it('corrige la longitud por la latitud (a 60° N un grado de longitud mide la mitad)', () => {
    const r = projectPreview([[60, 0], [61, 1]], 400, 400, 0)!
    const dx = r.end[0] - r.start[0], dy = r.start[1] - r.end[1]
    expect(dx / dy).toBeCloseTo(0.5, 1)
  })

  it('devuelve null con menos de 2 puntos', () => {
    expect(projectPreview([], 100, 60)).toBeNull()
    expect(projectPreview([[1, 1]], 100, 60)).toBeNull()
  })
})

describe('pageList', () => {
  it('pocas páginas: todas', () => { expect(pageList(2, 5)).toEqual([1, 2, 3, 4, 5]) })
  it('muchas páginas: elipsis a ambos lados', () => { expect(pageList(10, 20)).toEqual([1, '…', 9, 10, 11, '…', 20]) })
  it('al principio y al final', () => {
    expect(pageList(1, 20)).toEqual([1, 2, 3, 4, '…', 20])
    expect(pageList(20, 20)).toEqual([1, '…', 17, 18, 19, 20])
  })
  it('una página', () => { expect(pageList(1, 1)).toEqual([1]) })
})

describe('helpers', () => {
  it('folderColor es estable y distingue carpetas', () => {
    expect(folderColor('Verano')).toBe(folderColor('Verano'))
    expect(folderColor('Verano')).not.toBe(folderColor('Invierno'))
    expect(folderColor(null)).toBe('#e85d24')
  })
  it('filterParams', () => {
    expect(filterParams({ kind: 'all' })).toEqual({})
    expect(filterParams({ kind: 'favorites' })).toEqual({ favorite: '1' })
    expect(filterParams({ kind: 'unfiled' })).toEqual({ unfiled: '1' })
    expect(filterParams({ kind: 'folder', name: 'A&B' })).toEqual({ folder: 'A&B' })
  })
})
