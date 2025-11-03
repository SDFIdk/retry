import { describe, it, beforeEach, mock } from 'node:test'
import assert from 'node:assert'
import nock from 'nock'
import { retryOptions, getTotalTime, fetchWithRetry, fetchWithRacedRetries, resetTimeoutCalc } from '../../src/retry.js'

const url = 'http://example.com'

const mockCall = (delay = 0, count = 1) => {
  return nock(url)
    .get('/')
    .delay(delay)
    .times(count)
    .reply(200, {})
}

describe('dynamic timeout tests', async () => {
  beforeEach(() => nock.cleanAll())

  it('Check that the dynamic timeout correctly increases the base timeout duration', async () => {
    resetTimeoutCalc()
    retryOptions.timeout = 50
    retryOptions.timeoutSignalHeuristic = 1
    mockCall(1000, 100)
    try {
      const response = await fetchWithRetry(url,
        {
          retries: 100,
          growthFactor: 2
        }
      )
      // 50 -> 100 -> 200 -> 400 -> 800 //attempt 2 succeeds
      assert.equal(retryOptions.timeout, 800)
    } catch (error) {
      assert.fail(error.message)
    }
  })

  it('Check that the dynamic timeout correctly reduces the base timeout duration', async () => {
    resetTimeoutCalc()
    retryOptions.timeout = 1600
    retryOptions.timeoutSignalHeuristic = 1
    try {
      mockCall(50, 50)
      for(let i = 0; i < 50; i++) {
        const response = await fetchWithRetry(url,
          {
            retries: 1,
            growthFactor: 2
          }
        )
      }
      // 1600 -> 800 -> 400 -> 200-> 100
      assert.equal(retryOptions.timeout, 100)
    } catch (error) {
      assert.fail(error.message)
    }
  })

  it('Check that the dynamic timeout correctly increases and reduces the base timeout duration', async () => {
    resetTimeoutCalc()
    retryOptions.timeout = 50
    retryOptions.timeoutSignalHeuristic = 1
    mockCall(2000, 50)
    try {
      const response = await fetchWithRetry(url,
        {
          retries: 50,
          growthFactor: 2
        }
      )
      // 50 -> 100 -> 200 -> 400 -> 800 -> 1600
      assert.equal(retryOptions.timeout, 1600)
      nock.cleanAll()
      mockCall(50, 50)
      for(let i = 0; i < 50; i++) {
        const response = await fetchWithRetry(url,
          {
            retries: 1,
            growthFactor: 2
          }
        )
      }
      // 1600 -> 800 -> 400 -> 200 -> 100
      assert.equal(retryOptions.timeout, 100)
    } catch (error) {
      assert.fail(error.message)
    }
  })

  it('check that dynamic timeout increases correctly for retryWithRacedPromises', async () => {
    resetTimeoutCalc()
    retryOptions.timeout = 50
    retryOptions.maxTimeout = getTotalTime()
    retryOptions.timeoutSignalHeuristic = 1
    
    mockCall(400, 15)
    for(let i = 0; i < 5; i++) {
      const response1 = await fetchWithRacedRetries(url, {
        retries: 2,  //50 * 2^2 = 200  when timining out 
        growthFactor: 2
      })
    }
    assert.equal(retryOptions.timeout, 800)

    nock.cleanAll()
    mockCall(25, 10)
    for(let i = 0; i < 10; i++) {
      const response2 = await fetchWithRacedRetries(url, {
        retries: 2,
        growthFactor: 2
      })
    }
    // 100 -> 50
    assert.equal(retryOptions.timeout, 100)
  })


  it('Check that dynamic timeout respects minTimeout boundary', async () => {
    resetTimeoutCalc()
    retryOptions.timeout = 200
    retryOptions.minTimeout = 100
    retryOptions.timeoutSignalHeuristic = 1
    
    mockCall(10, 50)
    for(let i = 0; i < 50; i++) {
      const response = await fetchWithRetry(url, {
        retries: 1,
        growthFactor: 2
      })
    }
    // Should decrease but stop at minTimeout
    // 200 -> 100 (stops here)
    assert.equal(retryOptions.timeout, 100)
  })

  it('Check that dynamic timeout respects maxTimeout boundary', async () => {
    resetTimeoutCalc()
    retryOptions.timeout = 100
    retryOptions.maxTimeout = 400
    retryOptions.timeoutSignalHeuristic = 1
    
    mockCall(5000, 100)
    try {
      const response = await fetchWithRetry(url, {
        retries: 100,
        growthFactor: 2
      })
      // Should increase but stop at maxTimeout
      // 100 -> 200 -> 400 (stops here)
      assert.equal(retryOptions.timeout, 400)
    } catch (error) {
      assert.fail(error.message)
    }
  })
  it('Check that timeoutSignalHeuristic requires multiple signals to change', async () => {
    resetTimeoutCalc()
    retryOptions.timeout = 100
    retryOptions.timeoutSignalHeuristic = 3  // Require 3 signals
    
    mockCall(1000, 100)
    try {
      const response = await fetchWithRetry(url, {
        retries: 100,
        growthFactor: 2
      })
      // Need 3 consecutive signals to increase
      // First 3 timeouts trigger first increase: 100 -> 200
      assert(retryOptions.timeout >= 200, 'Timeout should have increased')
    } catch (error) {
      assert.fail(error.message)
    }
  })
  it('Check that fetchWithRacedRetries adapts timeout with concurrent attempts', async () => {
    resetTimeoutCalc()
    retryOptions.timeout = 50
    retryOptions.maxTimeout = getTotalTime()
    retryOptions.timeoutSignalHeuristic = 1
    
    // Slow responses that will cause multiple concurrent attempts
    mockCall(500, 20)
    for(let i = 0; i < 5; i++) {
      const response = await fetchWithRacedRetries(url, {
        retries: 3,
        growthFactor: 2
      })
    }
    
    // Should increase timeout due to consistent slow responses
    assert(retryOptions.timeout >= 200, 
      `Timeout ${retryOptions.timeout} should have increased`)
  })
  it('Check that extreme outliers are guarded and do not skew average', async () => {
    resetTimeoutCalc()
    retryOptions.timeout = 100
    retryOptions.timeoutSignalHeuristic = 1
    
    // Mix of normal and extreme responses
    mockCall(80, 5)
    for(let i = 0; i < 5; i++) {
      await fetchWithRetry(url, { retries: 1, growthFactor: 2 })
    }
    
    const timeoutBefore = retryOptions.timeout
    
    nock.cleanAll()
    // Extreme outlier (should be guarded to timeout * 3)
    mockCall(10000, 1)
    try {
      await fetchWithRetry(url, { retries: 3, growthFactor: 2 })
      assert.fail("error should be thrown with extreme outliers")
    } catch (error) {
    }
    
    // Timeout shouldn't jump dramatically due to outlier guarding
    assert(retryOptions.timeout <= timeoutBefore * 4,
      'Outlier should be guarded and not cause extreme timeout increase')
  })

})

