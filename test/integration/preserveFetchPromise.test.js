import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import nock from 'nock'
import { preserveFetchPromise } from '../../src/retry.js'

const url = 'http://example.com'

const mockCall = (delay = 0, responseCode = 200, count = 1) => {
  return nock(url)
    .get('/')
    .delay(delay)
    .times(count)
    .reply(responseCode, {})
}


describe('preserveFetchTests', async () => {
  beforeEach(() => nock.cleanAll())
  it('Check that the attempt returns unresolved promise', async () => {
    const scope = nock(url)
      .get('/')
      .delay(100)
      .reply(200, {})
    try {
      const response = await preserveFetchPromise(
        url,
        { timeout: 50 }, [], 0, 200
      )
      assert(response.success === false && !response?.response)
    } catch (error) {
      assert.fail(`Error was thrown: ${error.message}`)
    }
  })
  it('Check that the attempt returns resolved promise', async () => {
    const scope = nock(url)
      .get('/')
      .delay(100)
      .reply(200, {})
    try {
      const response = await preserveFetchPromise(
        url,
        { timeout: 200 }, [], 0, 200
      )
      assert(response.success === true && response.response.status === 200)
    } catch (error) {
      assert.fail(`Error was thrown: ${error.message}`)
    }
  }),
  it('race multiple attempts and retrieve the first one to resolve', async () => {
    mockCall(250, 200)
    mockCall(100, 305)
    try {
      const weakTimedOutResponse = await preserveFetchPromise(
        url,
        { timeout: 200 },
        [],
        0,
        400
      )

      assert(weakTimedOutResponse.success === false && !weakTimedOutResponse?.response)
      const resolvedResponse = await (preserveFetchPromise(
        url,
        { timeout: 200 },
        [weakTimedOutResponse.promise],
        1,
        200
      ))
      assert(resolvedResponse.success === true && resolvedResponse.response.status === 200)
    } catch (error) {
      assert.fail(`Error was thrown: ${error.message}`)
    }
  }),
  it('preserveFetchPromise should be aborted at bad response error', async () => {
    mockCall(150, 500)
    mockCall(100, 200)
    try {
      const weakTimedOutResponse = await preserveFetchPromise(
        url,
        { timeout: 200 },
        [],
        0,
        400
      )
      console.log(weakTimedOutResponse)
      assert(weakTimedOutResponse.success === false && !weakTimedOutResponse?.response)
      const throwingResponse = await (preserveFetchPromise(
        url,
        { timeout: 200 },
        [weakTimedOutResponse.promise],
        1,
        200
      ))
      assert.fail('Error was not thrown')
    } catch (error) {
      console.log(error)
      assert.equal(error.message, 'Bad Response')
    }
  }),
  it('When one strong timeout is hit, we should trigger an error', async () => {
    mockCall(250, 305)
    mockCall(100, 200)
    try {
      const weakTimedOutResponse = await preserveFetchPromise(
        url,
        { timeout: 150 },
        [],
        0,
        200
      )
      assert(weakTimedOutResponse.success === false && !weakTimedOutResponse?.response)
      const throwingResponse = await (preserveFetchPromise(
        url,
        { timeout: 200 },
        [weakTimedOutResponse.promise],
        1,
        200
      ))
      assert.fail('Error was not thrown')
    } catch (error) {
      assert.equal(error.message, 'This operation was aborted')
    }
  })
})