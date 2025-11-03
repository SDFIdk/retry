import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import nock from 'nock'
import { fetchWithRacedRetries } from '../../src/retry.js'

const retries = 3
const timeout = 200
const growthFactor = 2
const totalTimeout = 800
const url = 'http://example.com'

const mockCall = (delay = 0, responseCode = 200, count = 1) => {
  return nock(url)
    .get('/')
    .delay(delay)
    .times(count)
    .reply(responseCode, {})
}

const options = {
  retries,
  timeout,
  growthFactor,
  totalTimeout
}

describe('fetchWithRacedRetries tests', async () => {
  beforeEach(() => nock.cleanAll())
  it('Check that the fetch works on the first attempt', async () => {
    mockCall(50)
    try {
      const response = await fetchWithRacedRetries(url, options)
      assert.equal(response.status, 200)
    } catch (error) {
      assert.fail(error.message)
    }
  }),
  it('check that multiple attempts returns the one that resolves first', async () => {
    mockCall(250, 200)
    mockCall(200, 300)
    try {
      const response = await fetchWithRacedRetries(url, options)
      assert.equal(response.status, 200)
    } catch (error) {
      assert.fail(error.message)
    }
  })

})