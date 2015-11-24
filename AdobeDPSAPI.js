var rest = require('restler');
var uuid = require('node-uuid');
var fs = require('fs');
var _ = require('lodash');

function AdobeDPSAPI(credentials) {
  this.options = {
    publish: {
      maxRetries: 15,
      timeBetweenRequests: 3000
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
AdobeDPSAPI.prototype.standardHeaders = function standardHeaders(options) {
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
AdobeDPSAPI.prototype.request = function request(type, url, options, callback) {
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
      throw new Error(data.error_code + " " + data.message);
    }
    if (callback) {
      callback(data, other);
    }
  });
}
// shortcut function for GET requests to the publication server
AdobeDPSAPI.prototype.publicationGet = function publicationGet(entityUri, callback) {
  var uri = "https://pecs.publish.adobe.io/publication/"+this.credentials.publication_id+"/"+entityUri;
  this.request('get', uri, {}, callback);
}
// shortcut function for GET requests to the publication server
AdobeDPSAPI.prototype.getStatus = function getStatus(entityUri, callback) {
  var uri = "https://pecs.publish.adobe.io/status/"+this.credentials.publication_id+"/"+entityUri;
  this.request('get', uri, {}, callback);
}
// retrieve all publications
AdobeDPSAPI.prototype.getPublications = function getPublications(callback) {
  this.request('get', "https://authorization.publish.adobe.io/permissions", {headers: {'Authorization': 'bearer '+this.credentials.access_token}}, 
    function(data) {
      if (typeof data.code !== "undefined" && data.code.indexOf("Exception") > -1) {
        throw new Error(data.message + " (" + data.code + ")");
      }
      callback(data);
    }
  );
}
// get a new access token
AdobeDPSAPI.prototype.getAccessToken = function getAccessToken(callback) {
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
      throw new Error(data.message + " (" + data.code + ")");
    }
    if (callback) {
      callback(data);
    }
  });
}
AdobeDPSAPI.prototype.uploadArticle = function uploadArticle(articleId, fileName, callback) {
  var articleFile = fs.statSync(fileName);
  var fileSize = articleFile["size"];
  var lastIngestTime = 0;
  var articleData = null;
  var self = this;
  function checkStatus(uri, timesTried) {
    if (typeof timesTried === "undefined")
      timesTried = 0;
    if (timesTried > self.options.uploadArticle.maxRetries) {
      console.log('Failed to wait for ingestion to finish. (Tries exceeded)');
      return callback(articleData);
    }
    setTimeout(function() {
      self.getStatus(uri, function(data) {
        var status = 'unknown';
        for(var i = 0; i < data.length; i++) {
          var eventDate = new Date(data[i].eventDate);
          if (eventDate.getTime() > lastIngestTime && data[i].aspect == 'ingestion' && data[i].eventType=='success') {
            console.log("Successfully ingested "+uri)
            return callback(articleData);  
          }
          if (data[i].aspect == 'ingestion' && data[i].eventType=='progress') {
            status = 'ingestion';
          }
        }
        console.log("Waiting... ("+status+")");
        checkStatus(uri, timesTried+1);
      });
    }, self.options.uploadArticle.timeBetweenRequests);
  }
  function findLastEvent(uri, callback) {
    lastIngestTime = 0;
    self.getStatus(uri, function(data) {
      for(var i = 0; i < data.length; i++) {
        if (data[i].aspect == 'ingestion' && data[i].eventType=='success') {
          lastIngestTime = (new Date(data[i].eventDate)).getTime();
        }
      }
      callback();
    })
  }
  var uri = "article/"+articleId;
  findLastEvent(uri, function() {
    self.rest.put(
      "https://ings.publish.adobe.io/publication/"+self.credentials.publication_id+"/"+uri+"/contents/folio",
      { // options
        headers: self.standardHeaders({
          "Content-Type": "application/vnd.adobe.article+zip",
          "Content-Length": fileSize
        }),
        data: fs.readFileSync(fileName),
        accessToken: self.credentials.access_token
      }
    )
    .on('complete', function(data) {
      articleData = data;
      checkStatus(uri);  
    });
  });
}
AdobeDPSAPI.prototype.getPermissions = function getPermissions(callback) {
  var uri = "https://authorization.publish.adobe.io/permissions";
  this.request('get', uri, {}, callback);
}
AdobeDPSAPI.prototype.getArticle = function getArticle(articleId, callback) {
  this.publicationGet('article/'+articleId, callback);
}
AdobeDPSAPI.prototype.getCollections = function getCollections(callback) {
  this.publicationGet('collection', callback);
}
AdobeDPSAPI.prototype.getCollection = function getCollection(collectionId, callback) {
  this.publicationGet('collection/'+collectionId, callback);
}
AdobeDPSAPI.prototype.getCollectionElements = function getCollectionElements(collection, callback) {
  this.publicationGet('collection/'+collection.entityName+";version="+collection.version+"/contentElements", callback);
}
AdobeDPSAPI.prototype.publish = function publish(entityUri, callback) {
  var self = this;
  if (!Array.isArray(entityUri)) {
    entityUri = [entityUri];
  }
  // duplicate the array so we dont destroy the original
  var entityUri = JSON.parse(JSON.stringify(entityUri))
  var lastPublishTime = 0;
  // checks to see if we have successfully published the article before moving on
  function checkStatus(uri, timesTried) {
    if (typeof timesTried === "undefined")
      timesTried = 0;
    if (timesTried > self.options.publish.maxRetries) {
      console.log('Failed to wait for publishing to finish. (Tries exceeded)');
      return consumeEntity();
    }
    setTimeout(function() {
      self.getStatus(uri, function(data) {
        var status = 'unknown';
        for(var i = 0; i < data.length; i++) {
          var eventDate = new Date(data[i].eventDate);
          if (eventDate.getTime() > lastPublishTime && data[i].aspect == 'publishing' && data[i].eventType=='success') {
            console.log("Successfully published "+uri)
            return consumeEntity();  
          }
          if (status != 'ingestion' && data[i].aspect == 'publishing' && data[i].eventType=='progress') {
            status = 'publishing';
          }
          if (data[i].aspect == 'ingestion' && data[i].eventType=='progress') {
            status = 'ingestion';
          }
        }
        console.log("Waiting... ("+status+")");
        checkStatus(uri, timesTried+1);
      });
    }, self.options.publish.timeBetweenRequests);
  }
  function findLastEvent(uri, callback) {
    lastPublishTime = 0;
    self.getStatus(uri, function(data) {
      for(var i = 0; i < data.length; i++) {
        if (data[i].aspect == 'publishing' && data[i].eventType=='success') {
          lastPublishTime = (new Date(data[i].eventDate)).getTime();
        }
      }
      callback();
    })
  }
  // use the retrieved information to publish
  function processEntity(data) {
    if (typeof data.code !== "undefined" && data.code.indexOf("Exception") > -1) {
      console.log('Error: ' + data.message + " (" + data.code + ")");
      consumeEntity();
    }
    var body = {
      "workflowType": "publish",
      "entities": [],
      "publicationId": self.credentials.publication_id
    };
    if (typeof data.version !== "undefined") {
      body.entities.push("/publication/"+self.credentials.publication_id+"/"+data.entityType+"/"+data.entityName+";version="+data.version);
    }
    var requestOptions = { data: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
    // get the last publish time before we publish
    findLastEvent(data.entityType+"/"+data.entityName, function() {
      // then publish after we have it
      self.request('post', "https://pecs.publish.adobe.io/job", requestOptions, function() {
        checkTime = Date.now();
        console.log('Checking '+data.entityType+"/"+data.entityName);
        checkStatus(data.entityType+"/"+data.entityName);
      });
    })
  }
  // eat a uri from the array
  function consumeEntity() {
    if (!entityUri || entityUri.length <= 0) {
      console.log('Done publishing');
      return callback({});
    }
    self.publicationGet(entityUri.shift(), processEntity);
  }
  consumeEntity();
}
AdobeDPSAPI.prototype.putCollection = function putCollection(data, callback) {
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
  this.putEntity(data, callback);
}
AdobeDPSAPI.prototype.putEntity = function putEntity(data, callback) {
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
  this.request('put', url, requestOptions, function(response) {
    if (typeof response.code !== "undefined" && response.code.indexOf("Exception") > -1) {
      throw new Error(response.message + " (" + response.code + ")");
    }
    callback(response);
  });
}
AdobeDPSAPI.prototype.putArticle = function putArticle(data, callback) {
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
  this.putEntity(data, callback);
}
AdobeDPSAPI.prototype.addArticleToCollection = function addArticleToCollection(articleId, collectionId, callback) {
  var self = this;
  this.getCollection(collectionId, function(collection) {
    if (collection.code === 'EntityNotFoundException') {
      throw new Error("Collection " + collectionId + " not found.");
    }
    if (typeof collection.code !== "undefined" && collection.code.indexOf("Exception") > -1) {
      throw new Error(collection.message + " (" + collection.code + ")");
    }
    self.getCollectionElements(collection, function(contentElements) {
      self.getArticle(articleId, function(article) {
        if (typeof article.code !== "undefined" && article.code.indexOf("Exception") > -1) {
          throw new Error(article.message + " (" + article.code + ")");
        }
        // remove previous versions of the article if they exist
        for(var i = 0; i < contentElements.length; i++) {
          if (contentElements[i].href.match('article/'+article.entityName+';')) {
            contentElements.splice(i, 1);
          }
        }
        if (typeof contentElements === 'undefined' || typeof contentElements.length === 'undefined') {
          contentElements = [];
        }
        contentElements.push( { href: '/publication/'+self.credentials.publication_id+'/article/'+article.entityName+';version='+article.version } );
        self.request( 
          'put', 
          "https://pecs.publish.adobe.io/publication/"+self.credentials.publication_id+'/collection/'+collection.entityName+";version="+collection.version+"/contentElements", 
          { 
            data: JSON.stringify(contentElements),
            headers: {
              'Content-Type': 'application/json'
            }
          }, 
          callback);
      });
    });
  });
}
AdobeDPSAPI.prototype.putImage = function putImage(entity, imagePath, type, callback) {
  var imageFile = fs.statSync(imagePath);
  var fileSize = imageFile["size"];
  var uploadId = uuid.v4();
  var self = this;
  if (type !== "background" && type !== 'thumbnail') {
    throw new Error("Incorrect image type");
  }
  this.rest.put(
    "https://pecs.publish.adobe.io"+entity._links.contentUrl.href+"images/"+type,
    { // options
      headers: this.standardHeaders({
        "Content-Type": this.mimetypes[imagePath.match(/([a-zA-Z]{3})$/)[0]],
        "Content-Length": fileSize,
        "X-DPS-Upload-Id": uploadId
      }),
      accessToken: this.credentials.access_token,
      data: fs.readFileSync(imagePath)
    }
  )
  .on('complete', function(data, response) {
    // get the most up to date entity data
    self.publicationGet(entity.entityType+"/"+entity.entityName, function(entity) {
      if (typeof entity.code !== "undefined" && entity.code.indexOf("Exception") > -1) {
        throw new Error(entity.message + " (" + entity.code + ")");
      }
      // add the reference to the content we just created
      entity['_links'][type] = { href: 'contents/images/'+type };
      // save it to the entity
      self.putEntity(entity, function(data) {
        if (typeof data.code !== "undefined" && data.code.indexOf("Exception") > -1) {
          throw new Error(data.message + " (" + data.code + ")");
        }
        // get the new version for the entity
        self.publicationGet(entity.entityType+"/"+entity.entityName, function(entity) {
          // seal() the image upload
          self.rest.put(
            "https://pecs.publish.adobe.io/publication/"+self.credentials.publication_id+"/"+entity.entityType+"/"+entity.entityName+";version="+entity.version+"/contents",
            {
              headers: self.standardHeaders({ 
                "X-DPS-Upload-Id": uploadId
              }),
              accessToken: self.credentials.access_token
            }
          )
          .on('complete', function(data, other) {
            if (typeof data.code !== "undefined" && data.code.indexOf("Exception") > -1) {
              throw new Error(data.message + " (" + data.code + ")");
            }
            if (callback) {
              callback(data);
            }
          });
        });
      });
    });
  });
}
AdobeDPSAPI.prototype.putArticleImage = function putArticleImage(article, imagePath, callback) {
  this.putImage(article, imagePath, "thumbnail", callback);
}

module.exports = AdobeDPSAPI;