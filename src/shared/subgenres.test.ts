import { describe, expect, it } from 'vitest'
import { makeMainSubgenre, SUBGENRES, toggleSubgenre, type SubgenreChoice } from './subgenres'

const none: SubgenreChoice = { main: null, others: [] }

describe('choosing subgenres', () => {
  it('makes the first pick the main subgenre', () => {
    expect(toggleSubgenre(none, 'house')).toEqual({ main: 'house', others: [] })
  })

  it('adds later picks as others, up to two', () => {
    let choice = toggleSubgenre(none, 'house')
    choice = toggleSubgenre(choice, 'techno')
    choice = toggleSubgenre(choice, 'trance')
    choice = toggleSubgenre(choice, 'dubstep')

    expect(choice).toEqual({ main: 'house', others: ['techno', 'trance'] })
  })

  it('removes an other when it is clicked again', () => {
    expect(toggleSubgenre({ main: 'house', others: ['techno', 'trance'] }, 'techno')).toEqual({
      main: 'house',
      others: ['trance']
    })
  })

  it('moves the first other up when the main is cleared', () => {
    expect(toggleSubgenre({ main: 'house', others: ['techno', 'trance'] }, 'house')).toEqual({
      main: 'techno',
      others: ['trance']
    })
  })

  it('swaps an other into main, keeping the old main as an other', () => {
    expect(makeMainSubgenre({ main: 'house', others: ['techno', 'trance'] }, 'trance')).toEqual({
      main: 'trance',
      others: ['house', 'techno']
    })
  })

  it('has unique ids', () => {
    expect(new Set(SUBGENRES.map((s) => s.id)).size).toBe(SUBGENRES.length)
  })
})
