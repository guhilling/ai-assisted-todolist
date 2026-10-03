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
// An /api request only reaches this function while the environment is down: then there is no
// /api/* behaviour, so it falls through to the default one. It gets a plain 503 instead of the
// app -- the frontend would otherwise read HTML as JSON and fail somewhere far from the cause.
function handler(event) {
  var request = event.request;

  if (request.uri === '/api' || request.uri.indexOf('/api/') === 0) {
    return {
      statusCode: 503,
      statusDescription: 'Service Unavailable',
      headers: {
        'content-type': { value: 'text/plain; charset=utf-8' },
        'cache-control': { value: 'no-store' }
      },
      body: { encoding: 'text', data: 'The backend is not running in this environment.\n' }
    };
  }

  var lastSegment = request.uri.substring(request.uri.lastIndexOf('/') + 1);

  if (lastSegment.indexOf('.') === -1) {
    request.uri = '/index.html';
  }

  return request;
}
