import {
  RETRY_ATTEMPTS,
  RETRY_TIMEOUT,
  RETRY_GROWTH_FACTOR,
  RETRY_STATUS_CODES,
  RETRY_DYNAMTIC_TIMEOUT
} from './constants.js'

const retryOptions = {
  retries: RETRY_ATTEMPTS,
  timeout: RETRY_TIMEOUT,
  growthFactor: RETRY_GROWTH_FACTOR,
  statusCodes: RETRY_STATUS_CODES,
  dynamicTimeout: RETRY_DYNAMTIC_TIMEOUT
}

let fetchCount = 0
let fetchResponseTimeSum = 0

function getAverageResponseTime() {
  return fetchResponseTimeSum / fetchCount
}

function updateBaseTimeout(responseTime) {
  if (!retryOptions.dynamicTimeout) return
  fetchCount += 1
  fetchResponseTimeSum += responseTime
  // Increase max timeout when average response time is more than half of the max.
  if (getAverageResponseTime() > retryOptions.timeout / 2) {
    retryOptions.timeout *= retryOptions.growthFactor
  // Reduce max timeout when the average response time is less than a quarter of the max.
  } else if (getAverageResponseTime() < retryOptions.timeout / 4) {
    retryOptions.timeout *= (1 / retryOptions.growthFactor) * 1.5
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

export {
  retryOptions,
  fetchWithTimeout,
  fetchWithRetry
}
