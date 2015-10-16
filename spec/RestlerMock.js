function RestlerMock() {
  this.requests = [];
}
function _request(url, options) {
  var request = new RestlerRequest(url, options);
  this.requests.push(request);
  return request;
}
RestlerMock.prototype.get = _request;
RestlerMock.prototype.post = _request;
RestlerMock.prototype.put = _request;
function RestlerRequest(url, options) {
  this.url = url;
  this.options = options;
}
RestlerRequest.prototype.on = function(type, callback) {
  this[type] = callback;
}
module.exports = RestlerMock;