import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import nock from 'nock'
import { retryOptions, fetchWithRetry } from '../../src/retry.js'

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
    retryOptions.timeout = 50
    mockCall(1000, 100)
    try {
      const response = await fetchWithRetry(url,
        {
          retries: 100,
          growthFactor: 2
        }
      )
      // 50 -> 100 -> 200 -> 400 -> 800 -> 1600
      assert.equal(retryOptions.timeout, 1600)
    } catch (error) {
      assert.fail(error.message)
    }
  })

  it('Check that the dynamic timeout correctly reduces the base timeout duration', async () => {
    retryOptions.timeout = 1600
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
      // 1600 -> 1200 -> 900 -> 675 -> 506.25 -> 379.6875 -> 284.765625
      assert.equal(retryOptions.timeout, 284.765625)
    } catch (error) {
      assert.fail(error.message)
    }
  })

  it('Check that the dynamic timeout correctly increases and reduces the base timeout duration', async () => {
    retryOptions.timeout = 50
    mockCall(2000, 50)
    try {
      const response = await fetchWithRetry(url,
        {
          retries: 50,
          growthFactor: 2
        }
      )
      // 50 -> 100 -> 200 -> 400
      assert.equal(retryOptions.timeout, 400)
      nock.cleanAll()
      mockCall(0, 50)
      for(let i = 0; i < 50; i++) {
        const response = await fetchWithRetry(url,
          {
            retries: 1,
            growthFactor: 2
          }
        )
      }
      // 400 -> 300
      assert.equal(retryOptions.timeout, 300)
    } catch (error) {
      assert.fail(error.message)
    }
  })
})
