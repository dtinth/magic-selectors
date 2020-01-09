# magic-selectors

Like `useEffect` but for selectors.

Under construction…

## Why?

### Problem

In an early stage of development of an application,
we might not want to deal with data loading.
We might decide to pre-load some data into the store **before** starting the application.

```js
function Application(props) {
  const [dataLoaded, setDataLoaded] = useState(false)
  const dispatch = useDispatch()

  useEffect(() => {
    dispatch(loadInitialData())
      .then(() => setDataLoaded(true))
      .catch(handleCatastrophicError)
  }, [dispatch])

  if (!dataLoaded) {
    return <LoadingScreen />
  }

  return <Layout>{/* ... */}</Layout>
}

function loadInitialData() {
  return async dispatch => {
    await Promise.all([
      dispatch(loadAllUsers()),
      dispatch(loadAllProjects()),
      dispatch(loadAllTags()),
      dispatch(loadSubscriptionInfo())
    ])
  }
}
```

and the component that renders the user name simply select the data from the store.

```js
function UserCard(props) {
  const user = useSelector(selectUserState(props.userId))
  //                       ^ selects a user or returns a default "unknown user" object
  return <Card title={user.name}>{/* ... */}</Card>
}
```

Over time, the app grows and there is more data to load.
Once 10kb, some long-time users have to wait for 200kb of data to load.
And we realized that not all data that we load beforehand are actually needed on first render.
For example, in the home page, we might not need the tags.

In modern React apps,
we select data from store with `useSelector` and fetch data with `useEffect` when we need to load it:

```js
function ProjectPage(props) {
  const { projectId } = props

  const dispatch = useDispatch()

  useEffect(() => {
    dispatch(fetchProjectDataIfNeeded(projectId))
  }, [projectId, dispatch])

  const projectData = useSelector(selectProjectData(projectId))

  return /* ... */
}
```

This ensures that if the data doesn’t already exist for something we try to display, it will be fetched and eventually displayed.

But what if **hundreds** of components selected the data from the store, assuming that the data is already there (or at least, being loaded).

- We could go ahead and add `useEffect` to all those 100+ components.

  - But some components are still using classes or higher-order components, so they can’t use `useEffect`. Some of them will get `componentDidMount` instead.
  - So, this will be a big sweeping change... But didn’t we use selectors to abstract our component away from the implementation detail of which part of the store the data came from?
  - Failure to add the effect in a component may mean that the component may be stuck at displaying the loading screen.

- We could stop using selectors directly and start using React hooks instead.

  - This looks interesting because hooks can also trigger effects, such as loading.
  - Again, 100+ components must be refactored to use hooks. This is a breaking change.
  - Some selectors are composed of other selectors. For example, `selectParticipants` might depend on `selectTask` + `selectUser`.
    That means to properly implement lazy loading, we need to convert all selectors into React hooks.

- Add some magic to `useSelector` (and react-redux’s `connect`) to allow selectors to fetch data on component’s behalf.

  - Think about it… selecting data from store and fetching data from API is deeply linked.
    It doesn’t make much sense to select data from the store without someone putting data into it, right?
    Shouldn’t the act of selecting something from the store signify that the data where we’re selecting needs to be fetched?
  - We modify the notion of selector (which originally means selecting some data from the store)
    to mean selecting some data from _wherever it needs to come from_.
    The selector thus is then responsible for making sure the data is in (or eventually will be in) the store.
  - By doing this, the data selection API stays the same (no breaking changes).

### Sketch of the solution

This component will look the same:

```js
function UserCard(props) {
  const user = useSelector(selectUserState(props.userId))
  return <Card title={user.name}>{/* ... */}</Card>
}
```

However `selectUserState` will be able to register some effect:

```js
const selectUserState = id => state => {
  useSelectorEffect(ensureUserIsFetched(id))
  return state.users[id]
}

const ensureUserIsFetched = makeParameterizedSelectorEffect(
  // Name, for debugging purposed.
  'ensureUserIsFetched',
  id => context => {
    const { store } = context
    // from here it is like useEffect
    // note: non-ideal code
    if (!store.getState().users[id]) store.dispatch(fetchUser(id))
    return () => {}
  }
)
```

Instead of calling stock `useSelector`, we wrap the `useSelector` API which can keep track of active effects.

```ts
declare function createSelectorEffectContext<T>(
  defaultContext: T
): {
  Provider: Provider<T>
  useSelectorEffect: (effect: Effect<T>) => void
  makeNamedSelectorEffect: (name: string, effect: Effect<T>) => Effect<T>
  makeParameterizedSelectorEffect: <P extends any[]>(
    name: string,
    createEffect: (...args: P) => Effect<T>
  ) => (...args: P) => Effect<T>
}

type Effect<T> = (context: T) => undefined | (() => void)
```
