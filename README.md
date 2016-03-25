# AEM Mobile API

Javascript Library for accessing AEM Mobile's API.

#### This software is currently a work in progress and the API or functionality may change at any time without warning.

## Getting Started

#### Installing
Run `npm install aem-mobile-api --save`

#### Using the Library
```javascript
var AEMMobileAPI = require('aem-mobile-api');
var api = new AEMMobileAPI({
  "device_id": "CHANGE_THIS",
  "device_secret": "CHANGE_THIS",
  "client_id": "CHANGE_THIS",
  "client_secret": "CHANGE_THIS",
  "publication_id": "CHANGE_THIS"
})
api.getAccessToken()
.then(function(data) {
  api.credentials.access_token = data.access_token
  return api.getArticle('AnExistingArticleId')
})
.then(function(article)) {
  // do stuff with your article metadata!
})
```

#### Documentation
Open the ./docs/index.html file in your browser for documentation.

## Contributing
In lieu of a formal styleguide, take care to maintain the existing coding style. Add unit tests for any new or changed functionality.

#### Generating documentation.
Changes to code should be paired with changes to documentation when necessary. Pull requests should include recompiled documentation. To recompile documentation, run `npm run-script prepublish`.

## Release History
_(Nothing yet)_
