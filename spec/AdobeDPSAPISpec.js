var AdobeDPSAPI = require('../AdobeDPSAPI.js');
var RestlerMock = require('./RestlerMock.js');

function createValidationFunction(done, expected) {
  return function(data) {
    expect(data).toEqual(expected);
    done();
  }
}

function doRequestEvaluation(args) {
  expect(args.api.rest[args.requestType]).toHaveBeenCalled();
  var request = args.api.rest.requests.pop();
  if(args.expectedUrl)
    expect(request.url).toEqual(args.expectedUrl);
  if(args.expectedOptions)
    expect(request.options).toEqual(jasmine.objectContaining(args.expectedOptions));
  request.complete(args.expectedData);
}

describe('AdobeDPSAPI', function() {
  var api;
  beforeEach(function() {
    api = new AdobeDPSAPI({
      publication_id: 'publicationid',
      client_id: 'cid',
      client_secret: 'csecret',
      device_id: 'did',
      device_secret: 'dsecret'
    });
    api.rest = new RestlerMock();
    spyOn(api.rest,'get').and.callThrough();
    spyOn(api.rest,'post').and.callThrough();
    spyOn(api.rest,'put').and.callThrough();
  });
  it('creates a session id and populates credentials object', function() {
    expect(api.sessionId).toBeDefined();
    expect((new AdobeDPSAPI({test: true})).credentials.test).toEqual(true);
  });
  describe('standardHeaders', function() {
    it('outputs necessary headers for most requests', function() {
      var headers = api.standardHeaders();
      expect(headers['X-DPS-Client-Version']).toBeDefined();
      expect(headers['X-DPS-Client-Id']).toEqual(api.credentials.client_id);
      expect(headers['X-DPS-Client-Request-Id']).toBeDefined();
      expect(headers['X-DPS-Client-Session-Id']).toBeDefined();
      expect(headers['X-DPS-Api-Key']).toEqual(api.credentials.client_id);
      expect(headers['Accept']).toBeDefined();
    });
    it('should add and overwrite the keys of the default object with the provided parameter', function() {
      var headers = api.standardHeaders({
        'X-DPS-Client-Version': 'test',
        'newKey': 'newValue'
      });
      expect(headers['X-DPS-Client-Version']).toEqual('test');
      expect(headers['newKey']).toEqual('newValue');
    });
  });
  describe('request', function() {
    it('should call to the given rest function with standard headers', function() {
      api.request('get', 'url', {}, function(){});
      var optionsExpected = {
        headers: api.standardHeaders(),
        accessToken: api.credentials.access_token
      };
      delete optionsExpected.headers['X-DPS-Client-Request-Id']; // random value
      optionsExpected.headers = jasmine.objectContaining(optionsExpected.headers);
      expect(api.rest.get).toHaveBeenCalledWith("url", jasmine.objectContaining(optionsExpected));
    });
    it('should fail on responses that include error_code', function() {
      api.request('get', 'url', {}, function(){});
      var request = api.rest.requests.pop();
      expect(function() {request.complete({error_code: '100', message: 'test'})}).toThrow(new Error("100 test"));
    });
  });
  describe('getPublications', function() {
    it('should call out to the auth endpoint and callback with the response', function(done) {
      var expected = { publications: [] };
      api.getPublications(createValidationFunction(done, expected));
      doRequestEvaluation({
        api: api,
        done: done,
        requestType: 'get',
        expectedData: expected,
        expectedUrl: 'https://authorization.publish.adobe.io/permissions',
        expectedOptions: {
          headers: jasmine.objectContaining({
            'Authorization': 'bearer '+api.credentials.access_token
          })
        }
      });
    });
    it('should throw an exception on an error return', function() {
      var error = { code: 'TestException', message: 'test' };
      api.getPublications(function(data) {});
      var request = api.rest.requests.pop();
      expect(function() {request.complete(error);}).toThrow(new Error("test (TestException)"));
    });
  });
  describe('getAccessToken', function() {
    it('should call out to the auth endpoint and callback with the response', function(done) {
      var expected = { access_token: 'test', refresh_token: 'refresh' };
      var expectedUrl = "https://ims-na1.adobelogin.com/ims/token/v1/?grant_type=device"+
        "&client_id="+api.credentials.client_id+
        '&client_secret='+api.credentials.client_secret+
        '&device_token='+api.credentials.device_secret+
        '&device_id='+api.credentials.device_id;
      api.getAccessToken(createValidationFunction(done, expected));
      doRequestEvaluation({
        api: api,
        done: done,
        requestType: 'post',
        expectedData: expected,
        expectedUrl: expectedUrl,
        expectedOptions: {
          headers: jasmine.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded'
          })
        }
      });
    });
    it('should throw an exception on an error return', function() {
      var error = { code: 'TestException', message: 'test' };
      api.getAccessToken(function(data) {});
      var request = api.rest.requests.pop();
      expect(function() {request.complete(error);}).toThrow(new Error("test (TestException)"));
    });
  });
})