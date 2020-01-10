import React, {
  createContext,
  useCallback,
  useEffect,
  useState,
  useContext,
  useMemo
} from 'react'

import { Selector, useSelector } from 'react-redux'

type Effect<T = unknown> = (context: T) => undefined | (() => void)

type SelectorEffectContext<T> = {
  SelectorEffectContextProvider: (props: {
    value: T
    children: React.ReactNode
  }) => React.ReactElement
  createCollector: () => SelectorEffectCollector<T>
  addSelectorEffect: (effect: Effect<T>) => void
  useMagicSelector: <State, TProps>(selector: Selector<State, TProps>) => TProps
  makeNamedSelectorEffect: (name: string, effect: Effect<T>) => Effect<T>
  makeParameterizedSelectorEffect: <P extends (string | number)[]>(
    name: string,
    createEffect: (...args: P) => Effect<T>
  ) => (...args: P) => Effect<T>
}

type SelectorEffectReactContext<T> = { selectorEffectContext: T }

export function createSelectorEffectContext<T>(): SelectorEffectContext<T> {
  const ReactContext = createContext<SelectorEffectReactContext<T> | null>(null)
  const activeCollector = new SelectorEffectActiveCollector<T>()
  const createCollector = () => new SelectorEffectCollector(activeCollector)
  const context: SelectorEffectContext<T> = {
    SelectorEffectContextProvider: function SelectorEffectContextProvider({
      value,
      children
    }) {
      const context = useMemo((): SelectorEffectReactContext<T> => {
        return { selectorEffectContext: value }
      }, [value])
      return (
        <ReactContext.Provider value={context}>
          {children}
        </ReactContext.Provider>
      )
    },
    createCollector,
    addSelectorEffect(effect) {
      if (activeCollector.current) {
        activeCollector.current.collect(effect)
      }
    },
    makeNamedSelectorEffect(name, effect) {
      return Object.assign(effect, { displayName: name })
    },
    makeParameterizedSelectorEffect(name, createEffect) {
      const effectMap = new Map<string, Effect<T>>()
      return (...args) => {
        const key = args.join(',')
        let effect = effectMap.get(key)
        if (!effect) {
          effect = context.makeNamedSelectorEffect(
            `${name}(${key})`,
            createEffect(...args)
          )
          effectMap.set(key, effect)
        }
        return effect
      }
    },
    useMagicSelector(selector) {
      const reactContext = useContext(ReactContext)
      if (!reactContext) {
        throw new Error(
          `useMagicSelector: Expected a selector effect context to be present. Did you forget to use SelectorEffectContextProvider?`
        )
      }
      const [subscriber] = useState(() => new MagicSelectorSubscriber<T>())
      const enhancedSelector = useCallback(
        state => {
          const collector = createCollector()
          collector.beginCollecting()
          try {
            return selector(state)
          } finally {
            collector.endCollecting()
            subscriber.handleEffects(collector.effects)
          }
        },
        [selector, subscriber]
      )
      const result = useSelector(enhancedSelector)
      useEffect(() => {
        subscriber.context = reactContext.selectorEffectContext
      }, [subscriber, reactContext])
      useEffect(() => {
        subscriber.handleMounted()
      }, [subscriber])
      useEffect(() => {
        subscriber.update()
      })
      useEffect(() => () => {
        subscriber.handleUnmounted()
        subscriber.update()
      })
      return result
    }
  }
  return context
}

class SelectorEffectActiveCollector<T> {
  current: SelectorEffectCollector<T> | null = null
}

export class SelectorEffectCollector<T = unknown> {
  effects?: Set<Effect<T>>
  constructor(
    private readonly activeCollector: SelectorEffectActiveCollector<T>
  ) {}
  collect(effect: Effect<T>) {
    if (!this.effects) this.effects = new Set()
    this.effects.add(effect)
  }
  beginCollecting() {
    this.activeCollector.current = this
  }
  endCollecting() {
    this.activeCollector.current = null
  }
}

class MagicSelectorSubscriber<T> {
  private mounted = false
  private activeEffects?: Map<Effect<any>, () => void>
  private targetEffects?: Set<Effect<any>>
  public context?: T
  handleUnmounted() {
    this.mounted = false
  }
  handleMounted() {
    this.mounted = true
  }
  handleEffects(effects?: Set<Effect<any>>) {
    this.targetEffects = effects
  }
  update() {
    if (!this.activeEffects && (!this.mounted || !this.targetEffects)) return
    if (!this.activeEffects) {
      this.activeEffects = new Map()
    }
    const activeEffects = this.activeEffects
    const targetEffects = this.mounted ? this.targetEffects : undefined
    if (targetEffects) {
      for (const effect of targetEffects) {
        if (!activeEffects.has(effect)) {
          let unsubscribe = effect(this.context!)
          if (unsubscribe === undefined) {
            unsubscribe = noop
          }
          if (typeof unsubscribe !== 'function') {
            throw new Error(
              `Expect effect ${describeEffect(
                effect
              )} to return either nothing or an unsubscribing function; received: ${unsubscribe}`
            )
          }
          activeEffects.set(effect, unsubscribe)
        }
      }
    }
    for (const [effect, unsubscribe] of activeEffects) {
      if (!targetEffects || !targetEffects.has(effect)) {
        unsubscribe()
        activeEffects.delete(effect)
      }
    }
  }
}

function noop() {}
function describeEffect(effect: Effect<any>) {
  return (effect as any).displayName || effect.name || '(unknown)'
}
