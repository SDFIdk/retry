# Retry

A npm package for easily adding retry to fetch calls with adaptive timeout and concurrent retry strategies.

## Getting Started

Install the [npm package](@dataforsyningen/retry):

```sh
npm install @dataforsyningen/retry
```

Import the options and functions you need, for instance:

```javascript
import { retryOptions, fetchWithRetry, fetchWithRacedRetries } from '@dataforsyningen/retry/index.js'
```

## Available Functions

### `fetchWithRetry(url, options)`

Sequential retry strategy that waits for each attempt to complete or timeout before starting the next one.

**Use when:**
- You want simple, predictable retry behavior
- Server resources are limited
- Order of attempts matters
- You need traditional sequential retry logic

```javascript
const response = await fetchWithRetry('https://api.example.com/data', {
  retries: 3,
  timeout: 500,
  growthFactor: 2
})
```

**How it works:**
1. Attempt 1 with timeout=500ms
2. If timeout or error, wait and retry with timeout=1000ms
3. If timeout or error, wait and retry with timeout=2000ms
4. Returns response or throws error after all retries exhausted

### `fetchWithRacedRetries(url, options)`

Concurrent retry strategy that launches new attempts when soft timeouts expire while keeping previous attempts alive. Returns the first successful response from any attempt.

**Use when:**
- You need the fastest possible response
- Network latency is unpredictable
- You can handle multiple concurrent requests
- Earlier attempts might succeed even after their soft timeout expires

```javascript
const response = await fetchWithRacedRetries('https://api.example.com/data', {
  retries: 3,
  timeout: 500,
  growthFactor: 2,
  totalTimeout: 10000  // Hard limit for all attempts
})
```

**How it works:**
1. Attempt 0 starts with soft timeout=500ms and hard timeout=10000ms
2. If soft timeout (500ms) expires before completion, Attempt 1 starts with soft timeout=1000ms
3. Attempt 0 continues running in background (not aborted)
4. Both attempts race - first successful response wins
5. If Attempt 1's soft timeout expires, Attempt 2 starts with soft timeout=2000ms
6. All three attempts race concurrently
7. First successful response is returned, other attempts continue until hard timeout

**Important:** Failed attempts are **not aborted** - they continue running until the hard timeout (`totalTimeout`) is reached. This allows slower attempts to potentially succeed and be returned.


## Configuration

You can set global options like this:

```javascript
import { retryOptions } from '@dataforsyningen/retry/index.js'
// Set the default retry timeout.
retryOptions.timeout = 200

// Enable/disable dynamically updating timeout.
retryOptions.dynamicTimeout = true

// Set timeout boundaries
retryOptions.minTimeout = 100
retryOptions.maxTimeout = 5000

// Configure how many signals needed before timeout adjustment
retryOptions.timeoutSignalHeuristic = 2
```


## Options

You can pass custom parameters in the options object in addition to fetch's usual options (see https://developer.mozilla.org/en-US/docs/Web/API/RequestInit).

### Retry Options

| Name | Default | Description |
| -------- | ------- | ------- |
| `retries` | 4 | The maximum number of retry attempts. |
| `timeout` | 500 | The initial timeout in milliseconds before attempting a retry (soft timeout for `fetchWithRacedRetries`). |
| `growthFactor` | 2 | The exponential growth factor which the timeout is multiplied by after each failed attempt. |
| `statusCodes` | [408, 500, 502, 503, 504, 506, 507, 508, 510] | HTTP response status codes that should trigger a retry. |
| `totalTimeout` | (calculated) | Hard timeout limit in milliseconds for all retry attempts combined (`fetchWithRacedRetries` only). Calculated as sum of exponential timeouts. |

### Dynamic Timeout Options

The library can automatically adjust the base timeout based on actual response times using a sliding window average:

| Name | Default | Description |
| -------- | ------- | ------- |
| `dynamicTimeout` | true | Enable/disable adaptive timeout adjustment based on response times. |
| `minTimeout` | 50 | Minimum allowed timeout in milliseconds. |
| `maxTimeout` | 5000 | Maximum allowed timeout in milliseconds. |
| `timeoutSignalHeuristic` | 2 | Number of consecutive slow/fast signals required before adjusting timeout. |

**How dynamic timeout works:**
- Maintains a sliding window of recent response times (default: last 10 measurements)
- Outliers (>3x current timeout) are guarded and capped at the current timeout value
- If average response time > 60% of current timeout → increment signal counter
- If average response time < 30% of current timeout → decrement signal counter
- When signal counter reaches ±`timeoutSignalHeuristic`, timeout is adjusted:
  - **Increase:** `timeout = timeout * growthFactor` (capped at `maxTimeout`)
  - **Decrease:** `timeout = timeout / growthFactor` (capped at `minTimeout`)
- Signal counter is reset after each adjustment


### Basic Usage with fetchWithRetry

```javascript
import { fetchWithRetry, retryOptions } from '@dataforsyningen/retry'

// Configure global options
retryOptions.timeout = 200
retryOptions.dynamicTimeout = false

// Make a request with retries
try {
  const response = await fetchWithRetry('https://api.example.com/data', {
    retries: 3,
    timeout: 500,
    growthFactor: 2
  })
  const data = await response.json()
  console.log(data)
} catch (error) {
  console.error('All retries failed:', error)
}
```

### Using fetchWithRacedRetries for Faster Response

```javascript
import { fetchWithRacedRetries } from '@dataforsyningen/retry'

// Race multiple concurrent attempts
try {
  const response = await fetchWithRacedRetries('https://api.example.com/data', {
    retries: 5,
    timeout: 300,
    growthFactor: 2,
    totalTimeout: 10000  // Hard timeout after 10 seconds
  })
  const data = await response.json()
  console.log(data)
} catch (error) {
  console.error('All concurrent attempts failed:', error)
}
```

### Implementation for tileloading
Here is an example of how to use it with an OpenLayers WMTS source:

```javascript
import WMTS from 'ol/source/WMTS'
import TileState from 'ol/TileState.js'

// create an options object to use in a WMTS source constructor. 
const options = {
    ...
}

// Add retry to the tileLoadFunction.
options.tileLoadFunction = function (tile, src) {
fetchWithRetry(src)
    .then(response => {
        if (!response.ok) {
            tile.setState(TileState.ERROR)
        }
        return response.blob()
    })
    .then(blob => {
        tile.getImage().src = URL.createObjectURL(blob)
    })
    .catch((e) => {
        tile.setState(TileState.ERROR)
    })
}

// Create the WMTS Source.
const wmtsSource = new WMTS(options)
```
