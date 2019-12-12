import React from 'react'
import ReactDOM from 'react-dom'
import { Provider } from 'react-redux'

import store from './app/store'

import './index.css'
import { SubscriptionProvider } from 'magic-selectors'

const render = () => {
  const App = require('./app/App').default

  ReactDOM.render(
    <SubscriptionProvider context={{ store }}>
      <Provider store={store}>
        <App />
      </Provider>
    </SubscriptionProvider>,
    document.getElementById('root')
  )
}

render()

if (process.env.NODE_ENV === 'development' && module.hot) {
  module.hot.accept('./app/App', render)
}
