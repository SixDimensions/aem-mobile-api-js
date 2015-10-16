var AdobeDPSAPI = require('../AdobeDPSAPI.js');
var RestlerMock = require('./RestlerMock.js');

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
      spyOn(api.rest,'get').and.callThrough();
      api.request('get', 'url', {}, function(){});
      var optionsExpected = {
        headers: api.standardHeaders(api.credentials),
        accessToken: api.credentials.access_token
      };
      delete optionsExpected.headers['X-DPS-Client-Request-Id']; // random value
      expect(api.rest.get).toHaveBeenCalledWith("url", jasmine.objectContaining(optionsExpected));
    });
  });
  describe('getPublications', function() {
    it('should call out to the auth endpoint', function(done) {
      spyOn(api.rest,'get').and.callThrough();
      var publications = { publications: [] };
      api.getPublications(function(data) {
        // verify that 'complete' is recieving data
        expect(data).toEqual(publications);
        done();
      });
      expect(api.rest.get).toHaveBeenCalled();
      var request = api.rest.requests.pop();
      // should be reaching out to the proper endpoint
      expect(request.url).toEqual('https://authorization.publish.adobe.io/permissions');
      // should be providing the correct access token
      expect(request.options.headers.Authorization).toEqual('bearer '+api.credentials.access_token);
      request.complete(publications, {});
    });
  });
})