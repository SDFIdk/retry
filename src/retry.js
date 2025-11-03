import {
  RETRY_ATTEMPTS,
  RETRY_TIMEOUT,
  RETRY_GROWTH_FACTOR,
  RETRY_STATUS_CODES,
  RETRY_DYNAMTIC_TIMEOUT,
  getTotalTime,
  RETRY_DYNAMIC_MIN_TIMEOUT,
  RETRY_DYNAMIC_MAX_TIMEOUT,
  RETRY_DYNAMIC_HEURISTIC
} from './constants.js'

const retryOptions = {
  retries: RETRY_ATTEMPTS,
  timeout: RETRY_TIMEOUT,
  growthFactor: RETRY_GROWTH_FACTOR,
  statusCodes: RETRY_STATUS_CODES,
  dynamicTimeout: RETRY_DYNAMTIC_TIMEOUT,
  maxTimeout: RETRY_DYNAMIC_MAX_TIMEOUT,
  minTimeout: RETRY_DYNAMIC_MIN_TIMEOUT,
  timeoutSignalHeuristic: RETRY_DYNAMIC_HEURISTIC,
  totalTimeout: getTotalTime(RETRY_TIMEOUT, RETRY_GROWTH_FACTOR, RETRY_ATTEMPTS)
}

let fetchCount = 0
let fetchResponseTimeSum = 0
let timeoutSignalCount = 0

const getAverageResponseTime = () => {
  return fetchResponseTimeSum / fetchCount
}

const extendTimeout = () => {
  const newTimeout = retryOptions.timeout * retryOptions.growthFactor
  retryOptions.timeout =  newTimeout > retryOptions.maxTimeout ? retryOptions.maxTimeout : newTimeout
  retryOptions.totalTime = getTotalTime(retryOptions.timeout, retryOptions.growthFactor, retryOptions.retries)
}

const contractTimeout = () => {
  const newTimeout = retryOptions.timeout * (1 / retryOptions.growthFactor)
  retryOptions.timeout *= newTimeout < retryOptions.minTimeout ? retryOptions.minTimeout : newTimeout 
  retryOptions.totalTime = getTotalTime(retryOptions.timeout, retryOptions.growthFactor, retryOptions.retries)
}


const updateBaseTimeout = (responseTime) => {
  if (!retryOptions.dynamicTimeout) return
  fetchCount += 1
  //Guard against against outliers that do not reflect average response time (i.e move stably up or down untill equilibrium is reached)
  fetchResponseTimeSum += responseTime > retryOptions.timeout*3 ? retryOptions.timeout : responseTime 
  // Increase max timeout when average response time is more than 3/5 of the max.
  if (getAverageResponseTime() > retryOptions.timeout * 0.6) {
    timeoutSignalCount++
    if(timeoutSignalCount >= retryOptions.timeoutSignalHeuristic) {
      extendTimeout()
      timeoutSignalCount = 0    
    }
  // Reduce max timeout when the average response time is less than 1/4 of the max.
  } else if (getAverageResponseTime() < retryOptions.timeout * 0.25) {
    timeoutSignalCount--
    if(timeoutSignalCount <= retryOptions.timeoutSignalHeuristic) {
      contractTimeout()
      timeoutSignalCount = 0    
    }
  }
}

/**
 * Fetch with a max timeout.
 * @param {*} url - The endpoint URL for the HTTP GET request.
 * @param {*} options - Options (timeout) and https://developer.mozilla.org/en-US/docs/Web/API/RequestInit
 * @returns {}
 */
async function fetchWithTimeout(url, options = {}) {
  const { timeout = retryOptions.timeout } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  const response = await fetch(url, {
    ...options,
    signal: controller.signal
  })
  clearTimeout(timer)
  return response
}

/**
 * Fetch with retry and a max timeout.
 * @param {String} url - The endpoint URL for the HTTP GET request.
 * @param {*} options - Options (retries, timeout, growthFactor, statusCodes) and https://developer.mozilla.org/en-US/docs/Web/API/RequestInit
 * @returns *
 */
async function fetchWithRetry (url, options = {}) {
  const {
    retries = retryOptions.retries,
    timeout = retryOptions.timeout,
    growthFactor = retryOptions.growthFactor,
    statusCodes = retryOptions.statusCodes
  } = options
  const startTime = Date.now()
  try {
    const response = await fetchWithTimeout(url, options)
    if (statusCodes.includes(response.status)) {
      throw new Error('Bad response')
    }
    updateBaseTimeout(Date.now() - startTime)
    return response
  } catch (error) {
    updateBaseTimeout(Date.now() - startTime)
    if (retries > 0) {
      const optionsCopy = structuredClone(options)
      optionsCopy.retries = retries - 1
      optionsCopy.timeout = timeout * growthFactor
      return fetchWithRetry(url, optionsCopy)
    } else {
      throw new Error(`All retries failed. Url: ${url}`)
    }
  }
}

/**
 * Races a fetch attempt against a soft timeout while preserving the fetch promise for future races.
 * Used by retryPromiseAttempt to implement concurrent retry attempts with exponential backoff.
 * 
 * This function manages three racing conditions:
 * 1. The actual fetch request with a hard timeout (remainingTime) enforced by fetchWithTimeout
 * 2. A soft timeout (options.timeout) that triggers the next retry attempt while keeping this fetch alive
 * 3. All previous valid fetch attempts (attemptArray) that are still running
 * 
 * 
 * @param {string} url - The endpoint URL for the HTTP request
 * @param {Object} options - Fetch options including:
 *   @param {number} [options.timeout] - Soft timeout in ms that triggers next retry (default: retryOptions.timeout)
 *   @param {number[]} [options.statusCodes] - HTTP status codes that should trigger retry (default: retryOptions.statusCodes)
 *   @param {RequestInit} [options.*] - Any additional fetch API options (headers, method, body, etc.)
 * @param {Object} preserveOptions - Configuration for promise preservation:
 *   @param {Promise<Object>[]} preserveOptions.attemptArray - Array of wrapper promises from previous timed-out attempts still running
 *   @param {number} preserveOptions.attemptNumber - Current attempt number (0-indexed)
 *   @param {number} preserveOptions.remainingTime - Hard timeout limit in ms for the total operation
 * 
 * @returns {Promise<Object>} Always resolves (never rejects) with one of:
 *   - **Success (valid response)**: `{success: true, promise: fetchPromiseWrapper, attemptNumber, response: Response}`
 *   - **Success (hard timeout reached)**: `{success: true, promise: fetchPromiseWrapper, attemptNumber, response: AbortError}`
 *   - **Retry (soft timeout)**: `{success: false, promise: fetchPromiseWrapper, attemptNumber}`
 *   - **Retry (retriable error)**: `{success: false, attemptNumber}`
 */
const preserveFetchPromise = (url, options, preserveOptions) => {
  // Extract from options
  const {
    timeout = retryOptions.timeout,
    statusCodes = retryOptions.statusCodes
  } = options

  // Extract from preserveOptions
  const {
    attemptArray,
    attemptNumber,
    remainingTime
  } = preserveOptions

  const startTime = Date.now()
  const clonedOptions = structuredClone(options)
  clonedOptions.timeout = remainingTime

  // Create the fetch promise that will resolve/reject based on response
  const fetchPromise = (async () => {
    try {
      const response = await fetchWithTimeout(url, clonedOptions)
      updateBaseTimeout(Date.now() - startTime)
      
      if (statusCodes.includes(response.status)) {
        throw new Error("[Retry] Invalid response code")
      }
      return response
    } catch (error) {
      updateBaseTimeout(Date.now() - startTime)
      throw error
    }
  })()

  // Wrap fetchPromise to always resolve and distinguish error types
  const fetchPromiseWrapper = fetchPromise.then(
    (response) => ({ success: true, promise: fetchPromiseWrapper, attemptNumber, response }),
    (error) => {
      // If it's a hard timeout (AbortError), we should stop retrying completely
      if (error.name === 'AbortError') {
        return { success: true, promise: fetchPromiseWrapper, attemptNumber, response: error }
      }
      // Otherwise it's a retriable error (network error, invalid status code, etc.)
      // Don't include promise in race - we won't wait for this attempt
      return { success: false, attemptNumber }
    }
  )

  // Soft timeout promise that resolves after timeout period
  const softTimeout = new Promise(resolve => {
    setTimeout(() => {
      // Include the wrapper promise so we can still race it in future attempts
      resolve({ success: false, promise: fetchPromiseWrapper, attemptNumber })
    }, timeout)
  })

  // Race the wrapped fetch against soft timeout and all previous attempts
  return Promise.race([
    softTimeout,
    fetchPromiseWrapper,
    ...attemptArray
  ])
}


/**
 * Recursively attempts fetch with exponentially increasing timeouts.
 * Launches new attempts when soft timeouts expire while keeping previous attempts alive.
 * 
 * @param {string} url - Endpoint to fetch
 * @param {Object} options - Fetch options including:
 *   @param {number} [options.timeout] - Soft timeout in ms that triggers next retry (default: retryOptions.timeout)
 *   @param {number[]} [options.statusCodes] - HTTP status codes that should trigger retry (default: retryOptions.statusCodes)
 *   @param {RequestInit} [options.*] - Any additional fetch API options (headers, method, body, etc.)
 * @param {Object} preserveOptions - Configuration for promise preservation:
 *   @param {Promise<Object>[]} preserveOptions.attemptArray - Array of wrapper promises from previous timed-out attempts still running
 *   @param {number} preserveOptions.attemptNumber - Current attempt number (0-indexed)
 *   @param {number} preserveOptions.remainingTime - Hard timeout limit in ms for the total operation
 * @returns {Promise<Response>} Resolves with first successful response from any attempt
 * @throws {AggregateError} When all attempts fail or exceed total timeout
 */
const retryPromiseAttempt = async (url, options, preserveOptions) => {
  const {
    retries = retryOptions.retries,
    timeout = retryOptions.timeout,
    growthFactor = retryOptions.growthFactor,
  } = options

  const {
    attemptArray,
    attemptNumber,
    remainingTime
  } = preserveOptions

  // Base case: all retries exhausted, return first thing that resolves/rejects.
  if (attemptNumber > retries) {
    return Promise.any(attemptArray).then(result => {
      if(result.success) {
        return result.response
      }
      throw new AggregateError([], 'All attempt exhausted')
    })
  }

  // Clone and increase timeout exponentially for this attempt
  const optionsClone = structuredClone(options)
  if(attemptNumber > 0) {
    optionsClone.timeout = timeout * growthFactor
  }


  const attemptResult = await preserveFetchPromise(url, optionsClone, preserveOptions)


  if (attemptResult.success) {
    //console.log(`Fetch Promise ${attemptResult.attemptNumber} out of ${attemptNumber}`)
    return attemptResult.response
  }

  const attemptArrayUpdate = attemptResult?.promise ? [...attemptArray, attemptResult.promise]: attemptArray

  return retryPromiseAttempt(url, optionsClone, 
    {
      attemptArray: attemptArrayUpdate,
      attemptNumber: attemptNumber + 1,
      remainingTime: remainingTime - optionsClone.timeout
    }
  )
}

/**
 * Fetch with retry that keeps all attempts alive and resolves with the first successful response.
 * Unlike fetchWithRetry, this preserves timed-out fetches and races them concurrently.
 * 
 * @param {string} url - The endpoint URL for the HTTP request
 * @param {Object} options - Fetch options (retries, timeout, growthFactor, statusCodes) as well as normal Fetch Headers
 * 
 * @returns {Promise<Response>} Resolves with first resolved response (failed or successfull) from any attempt
 * @throws {Error} When all retry attempts fail
 */
const fetchWithRacedRetries = async (url, options = {}) => {
  const {
    timeout = retryOptions.timeout,
    statusCodes = retryOptions.statusCodes,
    growthFactor = retryOptions.growthFactor,
    totalTimeout = retryOptions.totalTimeout
  } = options
  
  const initialState = {
    attemptArray: [],
    attemptNumber: 0,
    remainingTime: totalTimeout
  }

  try {
    return await retryPromiseAttempt(url, { ...options, timeout, statusCodes, growthFactor}, initialState)
  } catch (error) {
    throw new Error(`All retries failed. Url: ${url}, msg: ${error.message}`)
  }
}

export {
  retryOptions,
  getTotalTime,
  fetchWithTimeout,
  fetchWithRetry,
  preserveFetchPromise,
  retryPromiseAttempt,
  fetchWithRacedRetries
}
