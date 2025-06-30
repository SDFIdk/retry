# Retry

A npm package for easily adding retry to fetch calls.

## Getting Started

Install the [npm package](@dataforsyningen/retry):

```
npm install @dataforsyningen/retry
```

Import the options and functions you need, for instance:

```
import { retryOptions, fetchWithRetry } from '@dataforsyningen/retry/index.js'
```

You can set global options like this:

```
// Set the default retry timeout.
retryOptions.timeout = 200
// disable dynamically updating timeout.
retryOptions.dynamicTimeout = false
```

And you can use the retry with fetch like the usual fetch calls:

```
fetchWithRetry(resource, options)
```

You can pass custom parameters in the options object in additional to fetch's usual options (see https://developer.mozilla.org/en-US/docs/Web/API/RequestInit).

Here are the possible options:
| Name | Default | Description |
| -------- | ------- | ------- |
| `retries` | 4 | The number of times the application should attempt to retry API calls. |
| `timeout` | 500 | The time the application should wait before attempting a retry. |
| `growthFactor` | 2 | The exponential growth factor which the timeout is multiplied by after each failed attempt. |
| `statusCodes` | [408, 500, 502, 503, 504, 506, 507, 508, 510] | The response status codes where a retry should be attempted. |

Here is an example of how to use it with an OpenLayers WMTS source:

```
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
