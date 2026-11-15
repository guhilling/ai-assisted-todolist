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
//
// An /api request reaches this function only as the bare /api, which the /api/* behaviour does not
// match. It gets a plain 404 instead of the app -- the frontend would otherwise read HTML as JSON
// and fail somewhere far from the cause. Until #557 it was a 503 saying the backend was down, as
// every /api request then got while the containers' environment was down.
function handler(event) {
  var request = event.request;

  if (request.uri === '/api' || request.uri.indexOf('/api/') === 0) {
    return {
      statusCode: 404,
      statusDescription: 'Not Found',
      headers: {
        'content-type': { value: 'text/plain; charset=utf-8' },
        'cache-control': { value: 'no-store' }
      },
      body: { encoding: 'text', data: 'There is no API route here.\n' }
    };
  }

  var lastSegment = request.uri.substring(request.uri.lastIndexOf('/') + 1);

  if (lastSegment.indexOf('.') === -1) {
    request.uri = '/index.html';
  }

  return request;
}
