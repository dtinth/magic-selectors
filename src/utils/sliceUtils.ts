import { Slice } from '@reduxjs/toolkit'

export function createSliceStateSelector<S>(
  slice: Slice<S, any>
): (state: any) => S {
  return state => state[slice.name]
}
