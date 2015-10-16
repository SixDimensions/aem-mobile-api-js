var rest = require('restler');
var uuid = require('node-uuid');
var fs = require('fs');
var _ = require('lodash');

function AdobeDPSAPI(credentials) {
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
  this.rest.put(
    "https://ings.publish.adobe.io/publication/"+this.credentials.publication_id+"/article/"+articleId+"/contents/folio",
    { // options
      headers: this.standardHeaders(api, {
        "Content-Type": "application/vnd.adobe.article+zip",
        "Content-Length": fileSize
      }),
      data: fs.readFileSync(fileName),
      accessToken: this.credentials.access_token
    }
  )
  .on('complete', function(data) {
    if (callback) {
      callback(data);
    }
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
  if (typeof entityUri.length === 'undefined') {
    entityUri = [entityUri];
  }
  var body = {
    "workflowType": "publish",
    "entities": [],
    "publicationId": this.credentials.publication_id
  };
  var retrieved = 0;
  function processEntity(data) {
    if (typeof data.version !== "undefined") {
      body.entities.push("/publication/"+this.credentials.publication_id+"/"+data.entityType+"/"+data.entityName+";version="+data.version);
    }
    retrieved++;
    if (retrieved === entityUri.length) {
      var requestOptions = { data: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
      this.request('post', "https://pecs.publish.adobe.io/job", requestOptions, callback);
    }
  }
  for(var i = 0; i < entityUri.length; i++) {
    this.publicationGet(entityUri[i], processEntity);
  }
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
  var url = "https://pecs.publish.adobe.io/publication/"+this.credentials.publication_id+"/article/"+data.entityName;
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
AdobeDPSAPI.prototype.addArticleToCollection = function addArticleToCollection(articleId, collectionId, callback) {
  this.getCollection(collectionId, function(collection) {
    if (collection.code === 'EntityNotFoundException') {
      throw new Error("Collection " + collectionId + " not found.");
    }
    if (typeof collection.code !== "undefined" && collection.code.indexOf("Exception") > -1) {
      throw new Error(collection.message + " (" + collection.code + ")");
    }
    this.getCollectionElements(collection, function(contentElements) {
      this.getArticle(articleId, function(article) {
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
        contentElements.push( { href: '/publication/'+this.credentials.publication_id+'/article/'+article.entityName+';version='+article.version } );
        this.request( 
          'put', 
          "https://pecs.publish.adobe.io/publication/"+this.credentials.publication_id+'/collection/'+collection.entityName+";version="+collection.version+"/contentElements", 
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
AdobeDPSAPI.prototype.putArticleImage = function putArticleImage(article, imagePath, callback) {
  var imageFile = fs.statSync(imagePath);
  var fileSize = imageFile["size"];
  var uploadId = uuid.v4();
  this.rest.put(
    "https://pecs.publish.adobe.io"+article._links.contentUrl.href+"images/thumbnail",
    { // options
      headers: this.standardHeaders(api, {
        "Content-Type": this.mimetypes[imagePath.match(/([a-zA-Z]{3})$/)[0]],
        "Content-Length": fileSize,
        "X-DPS-Upload-Id": uploadId
      }),
      accessToken: this.credentials.access_token,
      data: fs.readFileSync(imagePath)
    }
  )
  .on('complete', function(data, response) {
    // get the most up to date article data
    this.getArticle(article.entityName, function(article) {
      if (typeof article.code !== "undefined" && article.code.indexOf("Exception") > -1) {
        throw new Error(article.message + " (" + article.code + ")");
      }
      // add the reference to the content we just created
      article['_links']['thumbnail'] = { href: 'contents/images/thumbnail' };
      // save it to the article
      this.putArticle(article, function(data) {
        if (typeof data.code !== "undefined" && data.code.indexOf("Exception") > -1) {
          throw new Error(data.message + " (" + data.code + ")");
        }
        // get the new version for the article
        this.getArticle(article.entityName, function(article) {
          // seal() the image upload
          this.rest.put(
            "https://pecs.publish.adobe.io/publication/"+this.credentials.publication_id+"/article/"+article.entityName+";version="+article.version+"/contents",
            {
              headers: this.standardHeaders(api, { 
                "X-DPS-Upload-Id": uploadId
              }),
              accessToken: this.credentials.access_token
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

module.exports = AdobeDPSAPI;