import { Selector, useSelector } from 'react-redux'
import React, {
  useCallback,
  useRef,
  useEffect,
  createContext,
  useState,
  ReactNode,
  useContext
} from 'react'

export const SubscriptionManagerContext = createContext<SubscriptionManager | null>(
  null
)

let _currentCollector: SubscriptionCollector | null = null

class SubscriptionCollector {
  private collectedSubscriptionIntents = new Map<string, SubscriptionIntent>()
  collect(type: SubscriptionType, key: string) {
    const intent = new SubscriptionIntent(type, key)
    const mapKey = intent.toMapKey()
    if (!this.collectedSubscriptionIntents.has(mapKey)) {
      this.collectedSubscriptionIntents.set(
        mapKey,
        new SubscriptionIntent(type, key)
      )
    }
  }
  beginCollecting() {
    _currentCollector = this
  }
  endCollecting() {
    _currentCollector = null
  }
  getIntentMap() {
    return this.collectedSubscriptionIntents
  }
}

export class SubscriptionType<Context = any> {
  constructor(
    public name: string,
    public effect: (key: string, context: Context) => () => void
  ) {}
}

class SubscriptionIntent {
  private mapKey: string
  constructor(
    public readonly type: SubscriptionType,
    public readonly key: string
  ) {
    this.mapKey = `${this.type}#${this.key}`
  }
  toString() {
    return this.toMapKey()
  }
  toMapKey() {
    return this.mapKey
  }
}

export function wrapSelectorWithSubscription<State, TProps>(
  selector: Selector<State, TProps>,
  type: SubscriptionType<TProps>,
  key: string
): Selector<State, TProps> {
  return state => {
    const result = selector(state)
    if (_currentCollector) {
      _currentCollector.collect(type, key)
    }
    return result
  }
}

export function useSubscribableSelector<State, TProps>(
  selector: Selector<State, TProps>
): TProps {
  const subscriptionManager = useContext(SubscriptionManagerContext)
  if (!subscriptionManager) {
    throw new Error(
      `useSubscribableSelector: Did not find a parent <SubscriptionProvider>. ` +
        `Did you forget to put it in?`
    )
  }
  const subscriber = useRef<Subscriber | null>(null)
  if (subscriber.current === null) {
    subscriber.current = new Subscriber(subscriptionManager)
  }

  const enhancedSelector = useCallback(
    state => {
      const collector = new SubscriptionCollector()
      collector.beginCollecting()
      try {
        return selector(state)
      } finally {
        collector.endCollecting()
        subscriber.current!.handleCollectedSubscriptionIntents(
          collector.getIntentMap()
        )
      }
    },
    [selector]
  )
  const result = useSelector(enhancedSelector)
  useEffect(() => {
    subscriber.current!.handleMounted()
    return () => subscriber.current!.handleUnmounted()
  }, [])

  return result
}

class Subscriber {
  currentSubscriptions = new Map<string, Subscription>()
  nextSubscriptions?: Map<string, SubscriptionIntent>
  active = false
  constructor(private manager: SubscriptionManager) {}
  handleMounted() {
    this.active = true
    this.reconcile()
  }
  handleUnmounted() {
    this.active = false
    this.reconcile()
  }
  handleCollectedSubscriptionIntents(
    intentMap: Map<string, SubscriptionIntent>
  ) {
    this.nextSubscriptions = intentMap
    this.reconcile()
  }
  reconcile() {
    const currentSubscriptions = this.currentSubscriptions
    const target =
      (this.active && this.nextSubscriptions) ||
      new Map<string, SubscriptionIntent>()
    for (const [key, subscription] of currentSubscriptions) {
      if (!target.has(key)) {
        currentSubscriptions.delete(key)
        subscription.destroy()
      }
    }
    for (const [key, intent] of target) {
      if (!currentSubscriptions.has(key)) {
        const subscription = new Subscription(intent, this.manager)
        currentSubscriptions.set(key, subscription)
      }
    }
  }
}

class Subscription {
  static nextId = 1
  public id: number
  constructor(
    public intent: SubscriptionIntent,
    private manager: SubscriptionManager
  ) {
    this.id = Subscription.nextId++
    this.manager.addSubscription(this)
  }
  destroy() {
    this.manager.removeSubscription(this)
  }
}

type ActiveSubscription = {
  destroy: () => void
  subscriptions: Set<Subscription>
}

const noop = () => {}

export class SubscriptionManager<Context = any> {
  activeSubscriptionMap = new Map<string, ActiveSubscription>()
  constructor(public context: Context) {}
  addSubscription(subscription: Subscription) {
    const mapKey = subscription.intent.toMapKey()
    let activeSubscription = this.activeSubscriptionMap.get(mapKey)
    if (!activeSubscription) {
      activeSubscription = {
        destroy:
          subscription.intent.type.effect(
            subscription.intent.key,
            this.context
          ) || noop,
        subscriptions: new Set()
      }
      if (activeSubscription.destroy === noop) {
        console.warn(
          `The subscription effect function did not return an unsubscribe function. ` +
            `This can lead to memory leaks.`
        )
      }
      this.activeSubscriptionMap.set(mapKey, activeSubscription)
    }
    activeSubscription.subscriptions.add(subscription)
  }
  removeSubscription(subscription: Subscription) {
    const mapKey = subscription.intent.toMapKey()
    let activeSubscription = this.activeSubscriptionMap.get(mapKey)
    if (!activeSubscription) {
      return
    }
    activeSubscription.subscriptions.delete(subscription)
    if (activeSubscription.subscriptions.size === 0) {
      this.activeSubscriptionMap.delete(mapKey)
      activeSubscription.destroy()
    }
  }
}

type ProviderProps<Context> = {
  context: any
  children: ReactNode
}

export function SubscriptionProvider<Context = any>(
  props: ProviderProps<Context>
) {
  const context = props.context
  const [manager] = useState(
    () => new SubscriptionManager<Context>(props.context)
  )
  useEffect(() => {
    manager.context = context
  }, [context, manager])
  return (
    <SubscriptionManagerContext.Provider value={manager}>
      {props.children}
    </SubscriptionManagerContext.Provider>
  )
}
