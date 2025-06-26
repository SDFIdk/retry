import { RETRY_ATTEMPTS, RETRY_TIMEOUT, RETRY_GROWTH_FACTOR, RETRY_STATUS_CODES } from './constants.js'

/**
 * Fetch with a max timeout.
 * @param {*} url - The endpoint URL for the HTTP GET request.
 * @param {*} options - Options (timeout)
 * @returns 
 */
async function fetchWithTimeout(url, options = {}) {
  const { timeout = RETRY_TIMEOUT } = options
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
 * @param {*} options - Options (retries, timeout, growthFactor)
 * @returns *
 */
async function fetchWithRetry (url, options = {}) {
  const {
    retries = RETRY_ATTEMPTS,
    timeout = RETRY_TIMEOUT,
    growthFactor = RETRY_GROWTH_FACTOR,
    statusCodes = RETRY_STATUS_CODES
  } = options
  try {
    const response = await fetchWithTimeout(url, { timeout })
    if (statusCodes.includes(response.status)) {
      throw new Error('Bad response')
    }
    return response
  } catch (error) {
    if (retries > 0) {
      return fetchWithRetry(url, {
        retries: retries - 1,
        timeout: timeout * growthFactor,
        growthFactor
      })
    } else {
      throw new Error(`All retries failed. Url: ${url}`)
    }
  }
}

export {
  fetchWithTimeout,
  fetchWithRetry
}
