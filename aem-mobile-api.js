var rest = require('restler');
var uuid = require('uuid');
var fs = require('fs');
var _ = require('lodash');
var q = require('q');

/**
 * Error that is thrown for responses from the adobe API that include a `code` or `error_code`
 * @param {String} message  The exception error message
 * @param {Object} response The response from the server
 * @param {Object} data     Any additional data useful for debugging
 */
function APIError(message, response, data) {
  this.name = 'APIError';
  this.message = message || 'There was an API Error';
  this.response = response;
  this.data = data;
  this.stack = (new Error()).stack;
}
APIError.prototype = Object.create(Error.prototype);
APIError.prototype.constructor = APIError;

/**
 * Creates a new API object with the given credentials object.
 * @constructor
 * @param {Object} credentials - Contains `client_id`, `client_secret`,
 * `device_id`, `device_secret`, and `publication_id`.
 */
function AEMMobileAPI(credentials) {
  this.options = {
    publish: {
      maxRetries: 15,
      timeBetweenRequests: 5000
    },
    uploadArticle: {
      maxRetries: 20,
      timeBetweenRequests: 5000
    }
  }
  this.credentials = credentials;
  this.mimetypes = {
    png: "image/png",
    jpg: "image/jpeg"
  };
  this.sessionId = uuid.v4();
  this.rest = rest;
}
AEMMobileAPI.APIError = APIError;
/**
 * Utility method used to generate a set of headers that can be passed to
 * AEM Mobile's REST API.
 * Header properties that are passed into the function override any standard
 * headers that would be generated.
 * @param  {Object} options - Key-value headers that will be merged into a set
 * of standard headers and returned. The options object takes precedence over
 * the standard headers.
 * @return {Object} - Merged object with standard header values overwritten by
 * any options properties.
 */
AEMMobileAPI.prototype.standardHeaders = function standardHeaders(options) {
  var headers = {
    "X-DPS-Client-Version": '0.0.1',
    'X-DPS-Client-Id': this.credentials.client_id,
    "X-DPS-Client-Request-Id": uuid.v4(),
    "X-DPS-Client-Session-Id": this.sessionId,
    "X-DPS-Api-Key": this.credentials.client_id,
    "Accept": "application/json"
  };
  for (var key in options) { 
    headers[key] = options[key]; 
  }
  return headers;
}
/**
 * A low level function used to make direct HTTP REST requests to the API.
 * Returns a promise that will reject on any response that includes
 * `error_code` but not `code`.
 * @param  {String} type - get, put, del, post, or other methods supported by
 * restler.
 * @param  {String} url - The url to send the request to.
 * @param  {Object} options - An object that will be merged into a default set
 * of options that includes {@link AEMMobileAPI#standardHeaders} and an
 * accessToken. The properties of this object will take precedence over the
 * defaults.
 * @return {Promise}
 */
AEMMobileAPI.prototype.request = function request(type, url, options) {
  var deferred = q.defer();
  var defaultOptions = {
    headers: this.standardHeaders(),
    accessToken: this.credentials.access_token
  };
  this.rest[type](
    url,
    _.merge(defaultOptions, options)
  )
  .on('complete', function(data, other) {
    if (typeof data.error_code !== "undefined") {
      deferred.reject(new APIError(data.error_code + " " + data.message, data, options));
    }
    deferred.resolve({data: data, other: other});
  });
  return deferred.promise;
}
/**
 * A shortcut function to GET from the current publication. 
 * @param  {String} entityUri - Partial URI to GET from a publication. 
 * Should not have a leading slash "/".
 * @return {Promise}
 */
AEMMobileAPI.prototype.publicationGet = function publicationGet(entityUri) {
  var uri = "https://pecs.publish.adobe.io/publication/"+this.credentials.publication_id+"/"+entityUri;
  return this.request('get', uri, {}).then(function(response) { return response.data });
}
/**
 * A shortcut function to DELETE from the current publication. 
 * @param  {String} entityUri - Partial URI to DELETE from a publication.
 * Should not have a leading slash "/".
 * @return {Promise}
 */
AEMMobileAPI.prototype.publicationDelete = function publicationGet(entityUri) {
  var uri = "https://pecs.publish.adobe.io/publication/"+this.credentials.publication_id+"/"+entityUri;
  return this.request('del', uri, {}).then(function(response) { return response.data });
}
/**
 * A shortcut function to get the status object of a given entity.
 * @param  {String} entityUri - Partial URI to get the status object for.
 * Should not have a leading slash "/".
 * @return {Promise}
 */
AEMMobileAPI.prototype.getStatus = function getStatus(entityUri) {
  var uri = "https://pecs.publish.adobe.io/status/"+this.credentials.publication_id+"/"+entityUri;
  return this.request('get', uri, {}).then(function(response) { return response.data });
}
/**
 * Returns all publications available to the current API user.
 * @throws {Error} If the response includes a `code` that includes 'Exception'
 * then it will throw an error, causing the Promise to reject.
 * @return {Promise}
 */
AEMMobileAPI.prototype.getPublications = function getPublications() {
  return this.request(
    'get', 
    "https://authorization.publish.adobe.io/permissions", 
    {headers: {'Authorization': 'bearer '+this.credentials.access_token}}
  )
  .then(function(response) {
    var data = response.data;
    if (typeof data.code !== "undefined" && data.code.indexOf("Exception") > -1) {
      throw new APIError(data.message + " (" + data.code + ")", response, data);
    }
    return data;
  });
}
/**
 * Returns an object that includes an access_token that can be assigned to the
 * credentials object for further requests. This function does not set the
 * API's credentials.access_token property.
 * @throws {Error} If the response includes a `code` that includes 'Exception'
 * then it will throw an error, causing the Promise to reject.
 * @return {Promise}
 */
AEMMobileAPI.prototype.getAccessToken = function getAccessToken() {
  var deferred = q.defer();
  this.rest.post(
    "https://ims-na1.adobelogin.com/ims/token/v1/?grant_type=device"+
    "&scope=AdobeID,openid"+
    "&client_id="+this.credentials.client_id+
    '&client_secret='+this.credentials.client_secret+
    '&device_token='+this.credentials.device_secret+
    '&device_id='+this.credentials.device_id, 
    { // options
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  )
  .on('complete', function(data) {
    if (typeof data.code !== "undefined" && data.code.indexOf("Exception") > -1) {
      deferred.reject(new APIError(data.message + " (" + data.code + ")", data, false));
    }
    deferred.resolve(data);
  });
  return deferred.promise;
}
/**
 * Uploads a new article file to an article entity. The promise doesn't return
 * anything.
 * @param  {String} articleId - The entityName of the article file that will be
 * uploaded.
 * @param  {String} fileName - A path to the .article file to upload.
 * @return {Promise}
 */
AEMMobileAPI.prototype.uploadArticle = function uploadArticle(articleId, fileName) {
  var uri = "article/"+articleId;
  var articleFile = fs.statSync(fileName);
  var fileSize = articleFile["size"];
  var lastIngestTime = 0;
  var articleData = null;
  var self = this;

  function checkStatus(timesTried) {
    if (typeof timesTried === "undefined")
      timesTried = 0;
    if (timesTried > self.options.uploadArticle.maxRetries) {
      console.log('Failed to wait for ingestion to finish. (Tries exceeded)');
      return articleData;
    }
    return q.delay(self.options.uploadArticle.timeBetweenRequests)
    .then(function() {
      return self.getStatus(uri);
    })
    .then(function(data) {
      var status = 'unknown';
      for(var i = 0; i < data.length; i++) {
        var eventDate = new Date(data[i].eventDate);
        if (eventDate.getTime() > lastIngestTime && data[i].aspect == 'ingestion' && data[i].eventType=='success') {
          console.log("Successfully ingested "+uri)
          return articleData;  
        }
        if (data[i].aspect == 'ingestion' && data[i].eventType=='progress') {
          status = 'ingestion';
        }
      }
      console.log("Waiting... ("+status+")");
      return checkStatus(timesTried+1);
    });
  }


  return self.getStatus(uri)
  .then(function(data) {
    for(var i = 0; i < data.length; i++) {
      if (data[i].aspect == 'ingestion' && data[i].eventType=='success') {
        lastIngestTime = (new Date(data[i].eventDate)).getTime();
      }
    }
    return self.request(
      'put',
      "https://ings.publish.adobe.io/publication/"+self.credentials.publication_id+"/"+uri+"/contents/folio",
      { // options
        headers: {
          "Content-Type": "application/vnd.adobe.article+zip",
          "Content-Length": fileSize
        },
        data: fs.readFileSync(fileName),
      }
    );
  })
  .then(function(response) {
    articleData = response.data;
    return checkStatus();
  })
}
/**
 * Returns all permissions for the current API user.
 * @return {Promise}
 */
AEMMobileAPI.prototype.getPermissions = function getPermissions() {
  var uri = "https://authorization.publish.adobe.io/permissions";
  this.request('get', uri, {}).then(function(response) { return response.data });
}
/**
 * Returns the metadata for an article.
 * @param  {String} articleId - The entityName of the article data to retreive
 * from AEM Mobile.
 * @return {Promise}
 */
AEMMobileAPI.prototype.getArticle = function getArticle(articleId) {
  return this.publicationGet('article/'+articleId);
}
/**
 * Returns all collections in the current publication.
 * @return {Promise}
 */
AEMMobileAPI.prototype.getCollections = function getCollections() {
  return this.publicationGet('collection');
}
/**
 * Returns the metadata for a collection.
 * @param  {String} collectionId - The entityName of the collection to retrieve.
 * @return {Promise}
 */
AEMMobileAPI.prototype.getCollection = function getCollection(collectionId) {
  return this.publicationGet('collection/'+collectionId);
}
/**
 * Returns the array of objects referring to entities within a collection.
 * @param  {Object} collection - The metadata object for a collection. Requires
 * the `entityName` and `version` properties at a minimum.
 * @return {Promise}
 */
AEMMobileAPI.prototype.getCollectionElements = function getCollectionElements(collection) {
  return this.publicationGet('collection/'+collection.entityName+";version="+collection.version+"/contentElements");
}
/**
 * Shortcut function to {@link AEMMobileAPI#unpublish} that unpublishes the
 * given entity or entities. Accepts an Array of Strings or a single String.
 * @param  {Array|String} entityUri - The partial URI(s) for entities to 
 * unpublish. Does not include a leading slash "/".
 * @return {Promise}
 */
AEMMobileAPI.prototype.unpublish = function unpublish(entityUri) {
  return this.publish(entityUri, true);
}
/**
 * Publishes or unpublishes the given entity or entities. Accepts an
 * Array of Strings or a single String.
 * @param  {Array|String} entityUri - The partial URIs for the entity or
 * entities to publish or unpublish.
 * @param  {Boolean} unpublish - Unpublishes if truthy.
 * @return {Promise}
 * @throws {Error} If any entity cannot be retrieved from the publication
 * server.
 */
AEMMobileAPI.prototype.publish = function publish(entityUri, unpublish) {
  var self = this;
  if (!Array.isArray(entityUri)) {
    entityUri = [entityUri];
  }
  // duplicate the array so we dont destroy the original
  var entityUri = JSON.parse(JSON.stringify(entityUri));
  var entityCheckUri = "";
  var lastPublishTime = 0;
  var body = {
    "workflowType": "publish",
    "entities": [],
    "publicationId": self.credentials.publication_id
  };
  var verb = "published";
  var aspect = "publishing";
  if (unpublish) {
    body.workflowType = "unpublish";
    verb = "unpublished";
    aspect = "unpublishing"
  }

  // checks to see if we have successfully published the article before moving on
  function checkStatus(timesTried) {
    if (typeof timesTried === "undefined")
      timesTried = 0;
    if (timesTried > self.options.publish.maxRetries) {
      console.log('Failed to wait for '+aspect+' to finish. (Tries exceeded)');
      return
    }
    return q.delay(self.options.publish.timeBetweenRequests)
    .then(function() {
      return self.getStatus(entityCheckUri);
    })
    .then(function(data) {
      var status = 'unknown';
      for(var i = 0; i < data.length; i++) {
        if (aspect=='publishing') {
          var eventDate = new Date(data[i].eventDate);
          if (eventDate.getTime() > lastPublishTime && data[i].aspect == aspect && data[i].eventType=='success') {
            console.log("Successfully "+verb+" "+entityCheckUri)
            return;
          }
          if (status != 'ingestion' && data[i].aspect == aspect && data[i].eventType=='progress') {
            status = aspect;
          }
          if (data[i].aspect == 'ingestion' && data[i].eventType=='progress') {
            status = 'ingestion';
          }
        }
        else if (aspect=='unpublishing') { // unpublishing makes the publishing aspect disappear if it exists
          if (data[i].aspect == 'publishing') {
            status = 'unpublishing';
          }
        }
      }
      if (aspect == 'unpublishing' && status == 'unknown') {
        return;
      }
      console.log("Waiting... ("+status+")");
      return checkStatus(timesTried+1);
    })
  }
  

  var promises = [];
  for(var i in entityUri) {
    var entityName = entityUri[i];
    promises.push(
      self.publicationGet(entityName)
      .then(function processEntity(data) {
        if (typeof data.code !== "undefined" && data.code.indexOf("Exception") > -1) {
          console.log('Error: ' + data.message + " (" + data.code + ")");
          throw new APIError(data.message + " (" + data.code + ")", data, false)
        }
        if (typeof data.version !== "undefined") {
          body.entities.push("/publication/"+self.credentials.publication_id+"/"+data.entityType+"/"+data.entityName+";version="+data.version);
        }
        return data;
      })
    );
  }
  return q.all(promises)
  .then(function findLastEvent(results) {
    lastData = results[results.length-1];
    lastPublishTime = 0;
    return [lastData, self.getStatus(lastData.entityType+"/"+lastData.entityName)]
  })
  .spread(function(lastData, data) {
    for(var i = 0; i < data.length; i++) {
      if (data[i].aspect == aspect && data[i].eventType=='success') {
        lastPublishTime = (new Date(data[i].eventDate)).getTime();
      }
    }
    return [lastData, self.request('post', "https://pecs.publish.adobe.io/job", { data: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })];
  })
  .spread(function(lastData, response) {
    var data = response.data;
    if (typeof data.code !== 'undefined') {
      console.log(data.message);
      console.log("Failed "+aspect);
      return data;
    }
    checkTime = Date.now();
    console.log('Checking '+lastData.entityType+"/"+lastData.entityName);
    entityCheckUri = lastData.entityType+"/"+lastData.entityName;
    return checkStatus();
  })
}
/**
 * Saves collection metadata to the publication server. Shortcut to 
 * {@link AEMMobileAPI#putEntity}.
 * @param  {Object} data - Collection metadata to save.
 * @return {Promise}
 */
AEMMobileAPI.prototype.putCollection = function putCollection(data) {
  if (typeof data.entityType === 'undefined') {
    data.entityType = 'collection';
  }
  if (typeof data.importance === 'undefined') {
    data.importance = 'normal';
  }
  if (typeof data.title === 'undefined') {
    data.title = data.entityName;
  }
  data.entityType="collection";
  return this.putEntity(data);
}
/**
 * Saves entity metadata to the publication server.
 * @param  {Object} data - Entity metadata to save. Adobe server enforces
 * required properties and property schema, so this method does no property
 * validation.
 * @return {Promise}
 * @throws {Error} If the response includes a `code` value that includes 
 * 'Exception'.
 */
AEMMobileAPI.prototype.putEntity = function putEntity(data) {
  var url = "https://pecs.publish.adobe.io/publication/"+this.credentials.publication_id+"/"+data.entityType+"/"+data.entityName;
  if (data.version) {
    url+=";version="+data.version;
  }
  var requestOptions = { 
    data: JSON.stringify(data),
    headers: {
      'Content-Type': 'application/json'
    }
  };
  return this.request('put', url, requestOptions).then(function(response) {
    response = response.data;
    if (typeof response.code !== "undefined" && response.code.indexOf("Exception") > -1) {
      throw new APIError(response.message + " (" + response.code + ")", response, false);
    }
    return response;
  });
}
/**
 * Saves article metadata to the publication server. Shortcut to 
 * {@link AEMMobileAPI#putEntity}.
 * @param  {Object} data - Article metadata to save.
 * @return {Promise}
 */
AEMMobileAPI.prototype.putArticle = function putArticle(data) {
  if (typeof data.accessState === 'undefined') { 
    data.accessState = 'free';
  }
  if (typeof data.adType === 'undefined') {
    data.adType = 'static';
  }
  if (typeof data.entityType === 'undefined') {
    data.entityType = 'article';
  }
  if (typeof data.importance === 'undefined') {
    data.importance = 'normal';
  }
  if (typeof data.title === 'undefined') {
    data.title = data.entityName;
  }
  data.entityType="article";
  return this.putEntity(data);
}
/**
 * Adds an article to a collection, both by `entityName`.
 * @param {String} articleId - Article by `entityName` to add to the collection.
 * @param {String} collectionId - Collection by `entityName` to add to.
 * @return {Promise}
 * @throws {Error} If retrieving the collection or article fails.
 * @deprecated Use {@link AEMMobileAPI#addEntitiesToCollection} instead.
 */
AEMMobileAPI.prototype.addArticleToCollection = function addArticleToCollection(articleId, collectionId) {
  return this.addEntitiesToCollection(["article/"+articleId], collectionId);
}
/**
 * Adds an array of entities to a collection, both by `entityName`.
 * @param {Array} entityIds - Array of `entityType/entityName` to add to the collection.
 * @param {String} collectionId - Collection by `entityName` to add to.
 * @return {Promise}
 * @throws {Error} If retrieving the collection or entities fails, or if there is a failure to submit the new `collection.contentElements`.
 */
AEMMobileAPI.prototype.addEntitiesToCollection = function addEntitiesToCollection(entityIds, collectionId) {
  var self = this;
  var contentElements;
  return q.all(entityIds.map(function(entityId) {
    return self.publicationGet(entityId);
  }))
  .then(function(entities) {
    // make sure all our entities returned safely
    entities.forEach(function(entity, index) {
      if (entity.code === 'EntityNotFoundException') {
        throw new Error("Entity " + entityIds[index] + " not found.");
      }
      if (typeof entity.code !== "undefined" && entity.code.indexOf("Exception") > -1) {
        throw new APIError(entity.message + " (" + entity.code + ")", entity, entityIds[index]);
      }
    });
    return [entities, self.getCollection(collectionId)];
  })
  .spread(function(entities, collection) {
    if (collection.code === 'EntityNotFoundException') {
      throw new Error("Collection " + collectionId + " not found.");
    }
    if (typeof collection.code !== "undefined" && collection.code.indexOf("Exception") > -1) {
      throw new APIError(collection.message + " (" + collection.code + ")", collection, collectionId);
    }
    return [entities, collection, self.getCollectionElements(collection)];
  })
  .spread(function(entities, collection, contentElements) {
    if (typeof contentElements.code !== "undefined" && contentElements.code.indexOf("Exception") > -1) {
      throw new APIError(contentElements.message + " (" + contentElements.code + ")", contentElements, false);
    }
    if (typeof contentElements === 'undefined' || typeof contentElements.length === 'undefined') {
      contentElements = [];
    }
    entities.forEach(function(entity) {
      // remove previous versions of the entity if they exist
      for(var i = 0; i < contentElements.length; i++) {
        if (contentElements[i].href.match(entity.entityType+'/'+entity.entityName+';')) {
          contentElements.splice(i, 1);
        }
      }
      contentElements.push( { href: '/publication/'+self.credentials.publication_id+'/'+entity.entityType+'/'+entity.entityName+';version='+entity.version } );
    });
    return self.request( 
      'put', 
      "https://pecs.publish.adobe.io/publication/"+self.credentials.publication_id+'/collection/'+collection.entityName+";version="+collection.version+"/contentElements", 
      { 
        data: JSON.stringify(contentElements),
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
  })
  .then(function(response) {
    return response.data;
  });
}
/**
 * @param  {Object} entity - An entity metadata object. Required the `_links`, 
 * `entityType`, and `entityName` properties.
 * @param  {String} imagePath - Path to an image file to upload.
 * @param  {String} type - Either `background` or `thumbnail`.
 * @return {Promise}
 * @throws {Error} If type is not `background` or `thumbnail`. This occurs
 * before the return of the Promise.
 * @throws {Error} If retrieving or saving the entity fails.
 * @throws {Error} If sealing the image fails.
 */
AEMMobileAPI.prototype.putImage = function putImage(entity, imagePath, type) {
  var imageFile = fs.statSync(imagePath);
  var fileSize = imageFile["size"];
  var uploadId = uuid.v4();
  var self = this;
  if (type !== "background" && type !== 'thumbnail') {
    throw new Error("Incorrect image type");
  }
  return this.request(
    'put',
    "https://pecs.publish.adobe.io"+entity._links.contentUrl.href+"images/"+type,
    { // options
      headers: {
        "Content-Type": this.mimetypes[imagePath.match(/([a-zA-Z]{3})$/)[0]],
        "Content-Length": fileSize,
        "X-DPS-Upload-Id": uploadId
      },
      data: fs.readFileSync(imagePath)
    }
  )
  .then(function(response) {
    var data = response.data;
    // get the most up to date entity data
    return self.publicationGet(entity.entityType+"/"+entity.entityName)
  })
  .then(function(entity) {
    if (typeof entity.code !== "undefined" && entity.code.indexOf("Exception") > -1) {
      throw new APIError(entity.message + " (" + entity.code + ")", entity, false);
    }
    // add the reference to the content we just created
    entity['_links'][type] = { href: 'contents/images/'+type };
    return self.putEntity(entity);
  })
  .then(function(data) {
    if (typeof data.code !== "undefined" && data.code.indexOf("Exception") > -1) {
      throw new APIError(data.message + " (" + data.code + ")", data, false);
    }
    // get the new version for the entity
    return self.publicationGet(entity.entityType+"/"+entity.entityName);
  })
  // seal() the image upload
  .then(function(entity) {
    return self.request(
      'put',
      "https://pecs.publish.adobe.io/publication/"+self.credentials.publication_id+"/"+entity.entityType+"/"+entity.entityName+";version="+entity.version+"/contents",
      {
        headers: { 
          "X-DPS-Upload-Id": uploadId
        },
      }
    );
  })
  .then(function(response) {
    var data = response.data;
    if (typeof data.code !== "undefined" && data.code.indexOf("Exception") > -1) {
      throw new APIError(data.message + " (" + data.code + ")", response, data);
    }
    return data;
  });
}
/**
 * Shortcut method to {@link AEMMobileAPI#putImage} which uploads an image to
 * an entity with the type `thumbnail`.
 * @param  {Object} entity - Entity metadata object.
 * @param  {String} imagePath - Path to an image file to upload.
 * @return {Promise}
 */
AEMMobileAPI.prototype.putEntityThumbnail = function putEntityThumbnail(entity, imagePath) {
  return this.putImage(entity, imagePath, "thumbnail");
}
/**
 * Shortcut method to {@link AEMMobileAPI#putImage} which uploads an image to
 * an article with the type `thumbnail`.
 * @param  {Object} article - Article metadata object.
 * @param  {String} imagePath - Path to an image file to upload.
 * @return {Promise}
 * @deprecated Use {@link AEMMobileAPI#putEntityThumbnail} instead.
 */
AEMMobileAPI.prototype.putArticleImage = AEMMobileAPI.prototype.putEntityThumbnail;

module.exports = AEMMobileAPI;
