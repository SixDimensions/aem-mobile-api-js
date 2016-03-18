var rest = require('restler');
var uuid = require('node-uuid');
var fs = require('fs');
var _ = require('lodash');
var q = require('q');

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
      deferred.reject(new Error(data.error_code + " " + data.message));
    }
    deferred.resolve({data: data, other: other});
  });
  return deferred.promise;
}
// shortcut function for GET requests to the publication server
AEMMobileAPI.prototype.publicationGet = function publicationGet(entityUri) {
  var uri = "https://pecs.publish.adobe.io/publication/"+this.credentials.publication_id+"/"+entityUri;
  return this.request('get', uri, {}).then(function(response) { return response.data });
}
// shortcut function for DELETE requests to the publication server
AEMMobileAPI.prototype.publicationDelete = function publicationGet(entityUri) {
  var uri = "https://pecs.publish.adobe.io/publication/"+this.credentials.publication_id+"/"+entityUri;
  return this.request('del', uri, {}).then(function(response) { return response.data });
}
// shortcut function for GET requests to the publication server
AEMMobileAPI.prototype.getStatus = function getStatus(entityUri) {
  var uri = "https://pecs.publish.adobe.io/status/"+this.credentials.publication_id+"/"+entityUri;
  return this.request('get', uri, {}).then(function(response) { return response.data });
}
// retrieve all publications
AEMMobileAPI.prototype.getPublications = function getPublications() {
  return this.request(
    'get', 
    "https://authorization.publish.adobe.io/permissions", 
    {headers: {'Authorization': 'bearer '+this.credentials.access_token}}
  )
  .then(function(response) {
    var data = response.data;
    if (typeof data.code !== "undefined" && data.code.indexOf("Exception") > -1) {
      throw new Error(data.message + " (" + data.code + ")");
    }
    return data;
  });
}
// get a new access token
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
      deferred.reject(new Error(data.message + " (" + data.code + ")"));
    }
    deferred.resolve(data);
  });
  return deferred.promise;
}
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
AEMMobileAPI.prototype.getPermissions = function getPermissions() {
  var uri = "https://authorization.publish.adobe.io/permissions";
  this.request('get', uri, {}).then(function(response) { return response.data });
}
AEMMobileAPI.prototype.getArticle = function getArticle(articleId) {
  return this.publicationGet('article/'+articleId);
}
AEMMobileAPI.prototype.getCollections = function getCollections() {
  return this.publicationGet('collection');
}
AEMMobileAPI.prototype.getCollection = function getCollection(collectionId) {
  return this.publicationGet('collection/'+collectionId);
}
AEMMobileAPI.prototype.getCollectionElements = function getCollectionElements(collection) {
  return this.publicationGet('collection/'+collection.entityName+";version="+collection.version+"/contentElements");
}
AEMMobileAPI.prototype.unpublish = function unpublish(entityUri) {
  return this.publish(entityUri, true);
}
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
      throw new Error(response.message + " (" + response.code + ")");
    }
    return response;
  });
}
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
AEMMobileAPI.prototype.addArticleToCollection = function addArticleToCollection(articleId, collectionId) {
  var self = this;
  var contentElements;
  return this.getCollection(collectionId)
  .then(function(collection) {
    if (collection.code === 'EntityNotFoundException') {
      throw new Error("Collection " + collectionId + " not found.");
    }
    if (typeof collection.code !== "undefined" && collection.code.indexOf("Exception") > -1) {
      throw new Error(collection.message + " (" + collection.code + ")");
    }
    return [collection, self.getCollectionElements(collection), self.getArticle(articleId)];
  })
  .spread(function(collection, contentElements, article) {
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
      throw new Error(entity.message + " (" + entity.code + ")");
    }
    // add the reference to the content we just created
    entity['_links'][type] = { href: 'contents/images/'+type };
    return self.putEntity(entity);
  })
  .then(function(data) {
    if (typeof data.code !== "undefined" && data.code.indexOf("Exception") > -1) {
      throw new Error(data.message + " (" + data.code + ")");
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
      throw new Error(data.message + " (" + data.code + ")");
    }
    return data;
  });
}
AEMMobileAPI.prototype.putArticleImage = function putArticleImage(article, imagePath) {
  return this.putImage(article, imagePath, "thumbnail");
}

module.exports = AEMMobileAPI;
