// The number of times the application should attempt to retry API calls.
export const RETRY_ATTEMPTS = 4
// The time the application should wait before attempting a retry.
export const RETRY_TIMEOUT = 500
// The exponential growth factor which the timeout is multiplied by after each failed attempt.
export const RETRY_GROWTH_FACTOR = 2
// The response status codes where a retry should be attempted.
export const RETRY_STATUS_CODES = [408, 500, 502, 503, 504, 506, 507, 508, 510]
// The base timeout should dynamically update based on the average response time.
export const RETRY_DYNAMTIC_TIMEOUT = true

export const getTotalTime = (timeout, growthfactor, retries) => {
  let tempTimeout = timeout
  for(let i = 1; i <= retries; i++ ){
    tempTimeout += tempTimeout*growthfactor
  }
  return tempTimeout
}