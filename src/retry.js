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
 * @returns 
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
 * Races a fetch attempt against a timeout while preserving the fetch promise.
 * Used by retryPromiseAttempt to implement concurrent retry attempts.
 * 
 * Races three promises:
 * 1. fetchWithTimeout with hard timeout (remainingTime)
 * 2. Soft timeout that triggers next retry (options.timeout)
 * 3. All previously active fetch attempts
 * 
 * @param {string} url - The endpoint URL
 * @param {Object} options - Fetch options (timeout, statusCodes, etc.)
 * @param {Array<Promise>} activeAttempts - Promises from previous attempts still running
 * @param {number} attemptNumber - Current attempt number (0-indexed)
 * @param {number} remainingTime - Hard timeout limit for fetchWithTimeout
 * @returns {Promise<Object>} Resolves with:
 *   - {success: true, promise, attemptNumber, response} if fetch completes before soft timeout
 *   - {success: false, promise} if soft timeout expires (fetch continues in background)
 *   - Previous attempt's result if it completes first
 */
const preserveFetchPromise = (url, options, activeAttempts, attemptNumber, remainingTime) => {
  const {
    timeout = retryOptions.timeout,
    statusCodes = retryOptions.statusCodes
  } = options

  const startTime = Date.now()
  const clonedOptions = structuredClone(options)
  clonedOptions.timeout = remainingTime
  const fetchPromise = new Promise(async (resolve, reject) => {
    try {
      const response = await fetchWithTimeout(url, clonedOptions)

      const responseTime = Date.now() - startTime
      updateBaseTimeout(responseTime)

      if (statusCodes.includes(response.status)) {
        reject(new Error(`Bad Response`))
      } else {
        resolve(response)
      }
    } catch (error) {
      updateBaseTimeout(Date.now() - startTime)
      reject(error)
    }
  }).then(response => {
    return ({ success: true, promise: fetchPromise, attemptNumber: attemptNumber, response })
  })
  const attemptarr = [fetchPromise,
    new Promise(resolve => {
      setTimeout(() => {
        resolve({ success: false, promise: fetchPromise, attemptNumber: attemptNumber })
      }, timeout)
    }),
    ...activeAttempts]

  return Promise.race([
    ...attemptarr
  ])
}


/**
 * Recursively attempts fetch with exponentially increasing timeouts.
 * Launches new attempts when soft timeouts expire while keeping previous attempts alive.
 * 
 * @param {number} attemptNumber - Current attempt number (0-indexed)
 * @param {Array<Promise>} activeAttempts - Array of fetch promises from timed-out attempts still running
 * @param {string} url - The endpoint URL
 * @param {Object} options - Fetch options (timeout, statusCodes, etc.)
 * @returns {Promise<Response>} Resolves with first successful response from any attempt
 * @throws {AggregateError} When all attempts fail or exceed total timeout
 */
const retryPromiseAttempt = async (attemptNumber, activeAttempts, url, options, totalTimeout) => {
  // Base case: all retries exhausted, wait for any active fetch to complete
  if (attemptNumber > retryOptions.retries) {
    return Promise.any(activeAttempts)
  }

  // Clone and increase timeout exponentially for this attempt
  const optionsClone = structuredClone(options)
  if(attemptNumber > 0) {
    optionsClone.timeout = options.timeout * retryOptions.growthFactor
  }

  const attemptResult = await preserveFetchPromise(url, optionsClone, activeAttempts, attemptNumber, totalTimeout)

  if (attemptResult.success) {
    //console.log(`Fetch Promise ${attemptResult.attemptNumber} out of ${attemptNumber}`)
    return attemptResult.response
  } else {
    activeAttempts.push(attemptResult.promise)
    
    return retryPromiseAttempt(attemptNumber + 1, activeAttempts, url, optionsClone, totalTimeout - optionsClone.timeout)
  }
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
  
  try {
    return await retryPromiseAttempt(0, [], url, { ...options, timeout, statusCodes, growthFactor}, totalTimeout)
  } catch (error) {
    throw new Error(`All retries failed. Url: ${url}, msg: ${error.message}`)
  }
}

export {
  retryOptions,
  fetchWithTimeout,
  fetchWithRetry,
  preserveFetchPromise,
  retryPromiseAttempt,
  fetchWithRacedRetries
}
