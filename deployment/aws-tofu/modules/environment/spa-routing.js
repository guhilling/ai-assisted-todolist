// CloudFront Function on the site's default behaviour (edge.tf): a path whose last segment has no
// dot is a client-side route, and gets the app's index.html. A path that names a file is passed
// through, so a missing asset is still a 403 from the bucket rather than the app with a 200.
//
// It replaces httpd's `FallbackResource /index.html`. CloudFront's custom error responses would
// have been the obvious way, but they apply to every origin, so /api/* errors would have become
// index.html too. This runs only on the default behaviour; /api/* never sees it.
//
// CloudFront's runtime (cloudfront-js-2.0) has no modules: this is a script that declares
// `handler`. spa-routing.test.mjs loads it the same way.
function handler(event) {
  var request = event.request;
  var lastSegment = request.uri.substring(request.uri.lastIndexOf('/') + 1);

  if (lastSegment.indexOf('.') === -1) {
    request.uri = '/index.html';
  }

  return request;
}
